import type { NormalizedQuery, Offer } from "@/types";
import { convertToUsd } from "@/lib/currency";
import { isTrustedVendorUrl, TRUSTED_VENDOR_DOMAINS } from "@/lib/trustedVendors";
import { getAccessToken, getGcpProjectId } from "./vertexAuth";
import { callVertexGenerateContent, extractText, fetchWithTimeout, type GroundingChunk } from "./vertexRest";
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
// Empirically measured against the live endpoint across several queries: the grounded
// search call (call 1) typically takes 12-20s — Google executes real search queries
// before responding — with observed spikes well past that (one run needed ~25s+). This
// is real tail latency, not a fluke to special-case: 25s left no margin and intermittently
// aborted, silently serving mock data instead. The structured-extraction call (call 2, no
// tools) is comfortably ~6s, so it isn't the constraint. A generous shared budget avoids
// tuning this again on the next slow outlier. NOTE for eventual deployment: a serverless
// platform's function-duration limit (e.g. Vercel's default is much shorter) will need to
// be raised to match — see `maxDuration` route segment config — or this endpoint will hit
// a platform-level timeout regardless of this constant.
const CALL_TIMEOUT_MS = 45000;
const RESOLVE_TIMEOUT_MS = 5000;
const MAX_OFFERS = 8;
const DEFAULT_LOCATION = "us-central1";

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

function buildExtractionPrompt(answerText: string, resolved: ResolvedChunk[], productQuery: string): string {
  const list = resolved.map((r) => `${r.index}: ${r.domainLabel}`).join("\n");
  return `Web search summary about current prices for exactly this product: "${productQuery}"
${answerText}

Numbered list of verified retailers found in that search:
${list}

Extract one entry per distinct price mentioned above that (a) can be confidently attributed to one of the numbered retailers, AND (b) is genuinely the price of the exact product above — same size, model, and specs. Skip any price for an accessory, replacement part, mount, remote, cable, protection plan, case, or a different size/model/variant, even if the summary mentions it. When in doubt whether a price is for the exact product, omit it rather than guess. For each entry, output "storeIndex" as the number from the list above — never a store name or URL, only the index. Only include entries that map to a listed index. If a price isn't in USD, set "currency" to its 3-letter code, otherwise "USD".`;
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

    const searchPrompt = `Search the web for current prices, in USD, of exactly this product: "${query.query}" at reputable online retailers — especially ${TRUSTED_VENDOR_DOMAINS.join(", ")}.
Only report prices for the exact product described — the same size, model, and specs. Do NOT report prices for accessories, replacement parts, mounts, remotes, cables, protection plans, cases, or a different size/model/variant of the product, even if they show up in search results for this query.
Report each retailer where you find a real, current price for the exact product, along with the price and any shipping or rating information you can find.`;

    const call1 = await callVertexGenerateContent(
      MODEL,
      this.location,
      projectId,
      accessToken,
      {
        contents: [{ role: "user", parts: [{ text: searchPrompt }] }],
        tools: [{ googleSearch: {} }],
      },
      CALL_TIMEOUT_MS
    );

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

    const call2 = await callVertexGenerateContent(
      MODEL,
      this.location,
      projectId,
      accessToken,
      {
        contents: [{ role: "user", parts: [{ text: buildExtractionPrompt(answerText, resolved, query.query) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: OFFER_RESPONSE_SCHEMA,
        },
      },
      CALL_TIMEOUT_MS
    );

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

    const plausible = filterImplausiblePrices(offers);
    return plausible.sort((a, b) => a.price - b.price).slice(0, MAX_OFFERS);
  }
}

/**
 * Defensive safety net, complementing the prompt instructions above: even with an
 * explicit "exact product only" instruction, the model can still occasionally attribute
 * a price to the wrong item (a $49.97 "TV" that's actually a mount or remote, next to
 * genuine $600+ offers for the actual product). A price far below the pack's median is
 * the signature of that mismatch — a real bargain is rarely a fraction of what everyone
 * else charges. Only applied with 3+ offers, where a median is meaningful; with fewer,
 * there's no reliable "pack" to compare against, so nothing is dropped. (The median is
 * always drawn from the array itself, so at least half the offers are always >= it —
 * this can never filter down to zero, no fallback-to-unfiltered branch needed.)
 */
export function filterImplausiblePrices(offers: Offer[]): Offer[] {
  if (offers.length < 3) return offers;

  const sortedPrices = offers.map((o) => o.price).sort((a, b) => a - b);
  const mid = Math.floor(sortedPrices.length / 2);
  const median =
    sortedPrices.length % 2 === 0 ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2 : sortedPrices[mid];

  const MIN_FRACTION_OF_MEDIAN = 0.35;
  return offers.filter((o) => o.price >= median * MIN_FRACTION_OF_MEDIAN);
}
