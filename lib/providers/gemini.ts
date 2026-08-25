import type { NormalizedQuery, Offer } from "@/types";
import { convertToUsd } from "@/lib/currency";
import { isTrustedVendorUrl, TRUSTED_VENDOR_DOMAINS } from "@/lib/trustedVendors";
import { getAccessToken, getGcpProjectId } from "./vertexAuth";
import type { PriceProvider } from "./types";

// Live price source: Gemini on Vertex AI, called directly via fetch against the REST
// generateContent endpoint (no SDK) using a Bearer token from vertexAuth.ts. Gemini is
// a general-purpose model, not a shopping API, so this only works through grounded,
// verifiable citations — never anything the model writes in prose or invents itself.
//
// Two calls are required: combining the google_search grounding tool with a JSON
// response schema in a single call is a known-broken combination on this model
// generation (grounding metadata comes back empty), confirmed in this project's own
// testing.
//
//   1. Grounded search (tools: googleSearch) — get an answer plus citation chunks
//      (groundingMetadata.groundingChunks[].web). Each chunk's `uri` is a Google/Vertex
//      redirect link (vertexaisearch.cloud.google.com/...), NEVER the retailer's real
//      URL — it must never be shown or stored directly. `title` is a domain-like label,
//      usable only as a fast pre-filter.
//   2. RESOLVE — for each chunk that loosely matches a trusted domain by title, follow
//      its redirect (HEAD, GET fallback) to get the *final* URL, then run that through
//      isTrustedVendorUrl(). Only resolved, trusted URLs survive; this is what actually
//      becomes an offer's `url`.
//   3. Structured extraction (no tools, responseSchema) — pass call 1's answer text
//      plus a numbered list of the resolved, trusted chunks (index + domain label only,
//      no URLs) and ask the model to reference a storeIndex per offer. The model can
//      only ever pick an index into data already verified in step 2 — it never outputs
//      a URL or store name itself, so it cannot introduce an untrusted link.
//
// Google Search grounding also requires displaying the attribution widget
// (groundingMetadata.searchEntryPoint.renderedContent) wherever these results are
// shown — see components/SearchAttribution.tsx and lastAttributionHtml below.

const MODEL = "gemini-2.5-flash";
const CALL_TIMEOUT_MS = 15000;
const RESOLVE_TIMEOUT_MS = 5000;
const MAX_OFFERS = 8;
const DEFAULT_LOCATION = "us-central1";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface GenerateContentPart {
  text?: string;
}

interface GenerateContentCandidate {
  content?: { parts?: GenerateContentPart[] };
  groundingMetadata?: {
    groundingChunks?: GroundingChunk[];
    searchEntryPoint?: { renderedContent?: string };
  };
}

interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
}

async function callVertexGenerateContent(
  location: string,
  projectId: string,
  accessToken: string,
  body: unknown
): Promise<GenerateContentResponse> {
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${MODEL}:generateContent`;
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    CALL_TIMEOUT_MS
  );
  if (!res.ok) {
    throw new Error(`Vertex AI generateContent failed with HTTP ${res.status}`);
  }
  return res.json();
}

function extractText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p): p is { text: string } => typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}
interface GroundingChunk {
  web?: GroundingChunkWeb;
}

export interface ResolvedChunk {
  index: number;
  url: string;
  domainLabel: string;
}

function looselyMatchesTrustedDomain(title: string | undefined): boolean {
  if (!title) return false;
  const normalized = title.trim().toLowerCase();
  if (!normalized) return false;
  return TRUSTED_VENDOR_DOMAINS.some((domain) => normalized.includes(domain) || domain.includes(normalized));
}

/** Exported for unit testing. Follows redirects with a HEAD request (GET fallback), returning the final URL or null. */
export async function resolveFinalUrl(url: string): Promise<string | null> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetchWithTimeout(url, { method, redirect: "follow", credentials: "omit" }, RESOLVE_TIMEOUT_MS);
      // We only need the final URL, not the body — release it without reading.
      res.body?.cancel?.().catch(() => {});
      if (res.url) return res.url;
      if (method === "HEAD") continue;
      return null;
    } catch {
      if (method === "HEAD") continue;
      return null;
    }
  }
  return null;
}

/**
 * Exported for unit testing: pre-filters grounding chunks by title, resolves each
 * survivor's redirect to a final URL, and keeps only ones that pass isTrustedVendorUrl().
 * Untrusted final URLs never make it into the returned list — and therefore never reach
 * the structured-extraction call.
 */
export async function resolveGroundedChunks(chunks: GroundingChunk[]): Promise<ResolvedChunk[]> {
  const candidates = chunks.filter(
    (c): c is GroundingChunk & { web: { uri: string; title?: string } } =>
      typeof c.web?.uri === "string" && looselyMatchesTrustedDomain(c.web?.title)
  );

  const results = await Promise.all(
    candidates.map(async (c) => {
      const finalUrl = await resolveFinalUrl(c.web.uri);
      if (!finalUrl || !isTrustedVendorUrl(finalUrl)) return null;
      return { url: finalUrl, domainLabel: c.web.title ?? finalUrl };
    })
  );

  const resolved: ResolvedChunk[] = [];
  for (const r of results) {
    if (r) resolved.push({ index: resolved.length, url: r.url, domainLabel: r.domainLabel });
  }
  return resolved;
}

const OFFER_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      storeIndex: { type: "INTEGER" },
      price: { type: "NUMBER" },
      currency: { type: "STRING" },
      shipping: { type: "STRING" },
      rating: { type: "NUMBER" },
    },
    required: ["storeIndex", "price", "currency"],
  },
};

function buildExtractionPrompt(answerText: string, resolved: ResolvedChunk[]): string {
  const list = resolved.map((r) => `${r.index}: ${r.domainLabel}`).join("\n");
  return `Web search summary about current prices:
${answerText}

Numbered list of verified retailers found in that search:
${list}

Extract one entry per distinct price mentioned above that can be confidently attributed to one of the numbered retailers. For each entry, output "storeIndex" as the number from the list above — never a store name or URL, only the index. Only include entries that map to a listed index; omit anything you can't confidently map. If a price isn't in USD, set "currency" to its 3-letter code, otherwise "USD".`;
}

interface RawExtractedEntry {
  storeIndex?: unknown;
  price?: unknown;
  currency?: unknown;
  shipping?: unknown;
  rating?: unknown;
}

interface ValidatedOffer {
  store: string;
  price: number;
  url: string;
  currency: string;
  shipping?: string;
  rating?: number;
}

/**
 * Exported for unit testing: parses and validates call 2's raw JSON text, mapping each
 * storeIndex back to the resolved (trusted) chunk it refers to. An out-of-range or
 * non-integer storeIndex is dropped rather than trusted — the model never supplies a
 * URL directly, so no offer in the output can reference a URL absent from `resolved`.
 */
export function mapExtractedOffers(rawText: string, resolved: ResolvedChunk[]): ValidatedOffer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Vertex AI structured extraction returned invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Vertex AI structured extraction did not return an array");
  }

  const results: ValidatedOffer[] = [];
  for (const item of parsed as RawExtractedEntry[]) {
    if (typeof item !== "object" || item === null) continue;
    if (typeof item.storeIndex !== "number" || !Number.isInteger(item.storeIndex)) continue;
    const resolvedChunk = resolved[item.storeIndex];
    if (!resolvedChunk) continue; // out-of-range index — never trust it
    if (typeof item.price !== "number" || !(item.price > 0)) continue;

    results.push({
      store: resolvedChunk.domainLabel,
      price: item.price,
      url: resolvedChunk.url,
      currency:
        typeof item.currency === "string" && item.currency.trim().length > 0
          ? item.currency.trim().toUpperCase()
          : "USD",
      shipping: typeof item.shipping === "string" ? item.shipping : undefined,
      rating: typeof item.rating === "number" ? item.rating : undefined,
    });
  }
  return results;
}

export class GeminiPriceProvider implements PriceProvider {
  readonly name = "gemini" as const;
  private readonly location: string;
  /** Google Search grounding attribution HTML/CSS from the most recent successful search(), for the UI to render. */
  lastAttributionHtml: string | undefined;

  constructor(location?: string) {
    this.location = location && location.trim().length > 0 ? location : DEFAULT_LOCATION;
  }

  async search(query: NormalizedQuery): Promise<Offer[]> {
    this.lastAttributionHtml = undefined;

    const accessToken = await getAccessToken();
    const projectId = getGcpProjectId();

    const searchPrompt = `Search the web for current prices, in USD, of "${query.query}" at reputable online retailers — especially ${TRUSTED_VENDOR_DOMAINS.join(", ")}.
Report each retailer where you find a real, current price, along with the price and any shipping or rating information you can find.`;

    const call1 = await callVertexGenerateContent(this.location, projectId, accessToken, {
      contents: [{ role: "user", parts: [{ text: searchPrompt }] }],
      tools: [{ googleSearch: {} }],
    });

    const groundingMetadata = call1?.candidates?.[0]?.groundingMetadata;
    const chunks: GroundingChunk[] = groundingMetadata?.groundingChunks ?? [];
    if (chunks.length === 0) {
      throw new Error("Vertex AI grounded search returned no grounding chunks");
    }

    const answerText = extractText(call1);
    if (!answerText.trim()) {
      throw new Error("Vertex AI grounded search returned no answer text");
    }
    const renderedContent: string | undefined = groundingMetadata?.searchEntryPoint?.renderedContent;

    const resolved = await resolveGroundedChunks(chunks);
    if (resolved.length === 0) {
      throw new Error("No grounded citation resolved to a trusted retailer URL");
    }

    const call2 = await callVertexGenerateContent(this.location, projectId, accessToken, {
      contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(answerText, resolved) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: OFFER_RESPONSE_SCHEMA,
      },
    });

    const call2Text = extractText(call2);
    if (!call2Text.trim()) {
      throw new Error("Vertex AI structured extraction returned no text");
    }

    const validated = mapExtractedOffers(call2Text, resolved);
    if (validated.length === 0) {
      throw new Error("No offers survived structured extraction");
    }

    const offers: Offer[] = [];
    for (const v of validated) {
      try {
        const conversion = await convertToUsd(v.price, v.currency);
        offers.push({
          store: v.store,
          price: Math.round(conversion.amountUsd * 100) / 100,
          originalCurrency: conversion.converted ? v.currency : undefined,
          originalPrice: conversion.converted ? v.price : undefined,
          url: v.url,
          shipping: v.shipping,
          rating: v.rating,
        });
      } catch {
        // Skip offers whose currency can't be converted rather than showing a wrong price.
      }
    }
    if (offers.length === 0) {
      throw new Error("No offers survived currency conversion");
    }

    // Only set attribution once we know we're actually returning grounded results.
    this.lastAttributionHtml = renderedContent;

    return offers.sort((a, b) => a.price - b.price).slice(0, MAX_OFFERS);
  }
}
