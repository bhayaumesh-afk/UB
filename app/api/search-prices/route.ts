import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getPriceProvider, isDemoMode, mockProvider } from "@/lib/providers";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";
import type { NormalizedQuery, Offer, SearchPricesRequestBody, SearchPricesResponseBody } from "@/types";

export const runtime = "nodejs";

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

type ProviderSource = "serpapi" | "gemini" | "mock";

function normalizeQueryForCacheKey(query: SearchPricesRequestBody["query"]): string {
  return `search-prices:${query.query.trim().toLowerCase()}`;
}

function toNormalizedQuery(input: SearchPricesRequestBody["query"]): NormalizedQuery {
  if ("confidence" in input) return input;
  return { query: input.query, title: input.title ?? input.query, confidence: 1 };
}

function noticeFor(source: ProviderSource, demoMode: boolean): string | undefined {
  // The demo-mode notice only ever shows when we're actually serving mock data —
  // never on a successful SerpApi or Gemini answer.
  if (source !== "mock") return undefined;
  return demoMode
    ? "Demo mode — connect SERPAPI_KEY or GEMINI_API_KEY for live prices. Showing sample offers."
    : "Live price search is temporarily unavailable — showing sample offers instead.";
}

export async function POST(req: NextRequest): Promise<NextResponse<SearchPricesResponseBody>> {
  const ip = getClientIp(req.headers);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  let body: SearchPricesRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.query || typeof body.query.query !== "string" || body.query.query.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "query.query is required" }, { status: 400 });
  }

  const normalizedQuery = toNormalizedQuery(body.query);
  const cacheKey = normalizeQueryForCacheKey(body.query);
  const demoMode = isDemoMode();

  const cached = await cacheGet<{ offers: Offer[]; source: ProviderSource }>(cacheKey);
  if (cached) {
    return NextResponse.json({
      ok: true,
      offers: cached.offers,
      source: cached.source,
      demoMode,
      notice: noticeFor(cached.source, demoMode),
    });
  }

  const provider = getPriceProvider();
  const isLiveProvider = provider.name !== "mock";
  let offers: Offer[];
  let source: ProviderSource = provider.name;

  try {
    offers = await provider.search(normalizedQuery);
    if (offers.length === 0 && isLiveProvider) {
      throw new Error("No live offers found");
    }
  } catch (err) {
    console.error("search-prices provider error:", err instanceof Error ? err.message : "unknown error");
    // Graceful degradation: never show a blank error page — fall back to mock data.
    offers = await mockProvider.search(normalizedQuery);
    source = "mock";
  }

  await cacheSet(cacheKey, { offers, source }, CACHE_TTL_SECONDS);

  return NextResponse.json({ ok: true, offers, source, demoMode, notice: noticeFor(source, demoMode) });
}
