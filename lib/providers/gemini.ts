import { GoogleGenAI, Type } from "@google/genai";
import type { NormalizedQuery, Offer } from "@/types";
import { convertToUsd } from "@/lib/currency";
import { isTrustedVendorUrl, TRUSTED_VENDOR_DOMAINS } from "@/lib/trustedVendors";
import type { PriceProvider } from "./types";

// Live price source using the official Gemini SDK (Gemini Developer API, driven by
// GEMINI_API_KEY — not Vertex AI). Gemini is a general-purpose model, not a shopping
// API, so it must never be trusted to invent prices or URLs from its own knowledge.
// This uses a two-call pattern:
//
//   1. Grounded search (tools: googleSearch) — get a natural-language answer plus
//      real source URLs from groundingMetadata.groundingChunks[].web.uri. URLs are
//      taken ONLY from that field, never parsed out of the model's prose, since
//      prose URLs can be fabricated even with grounding enabled.
//   2. Structured extraction (responseMimeType: application/json, no tools) — turn
//      call 1's answer into Offer-shaped JSON, constrained to only the URLs found
//      in call 1. Gemini does not reliably support combining tool use with a
//      response schema in a single call, hence the split.
//
// Every resulting offer must (a) use a URL Gemini actually cited in call 1's
// grounding chunks and (b) pass isTrustedVendorUrl(). Offers failing either check
// are dropped. If nothing survives, or either call fails/times out, this throws so
// the caller falls back to the mock provider rather than showing a fabricated or
// empty result.

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.0-flash";
const CALL_TIMEOUT_MS = 15000;
const MAX_OFFERS = 8;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** True if the error looks like "this model id doesn't exist / isn't available", not a transient failure. */
function isModelUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|not available|unavailable|unsupported model|404/i.test(message);
}

interface GroundingChunkLike {
  web?: { uri?: string };
}

interface GroundedSearchResult {
  answerText: string;
  groundedUrls: string[];
}

async function runGroundedSearch(
  ai: GoogleGenAI,
  model: string,
  query: NormalizedQuery
): Promise<GroundedSearchResult> {
  const prompt = `Search the web for current prices, in USD, of "${query.query}" at reputable online retailers — especially ${TRUSTED_VENDOR_DOMAINS.join(", ")}.
Report each retailer where you find a real, current price, along with the price and any shipping or rating information you can find.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    }),
    CALL_TIMEOUT_MS,
    "Gemini grounded search"
  );

  const answerText = response.text ?? "";
  const chunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as GroundingChunkLike[];
  const groundedUrls = Array.from(
    new Set(chunks.map((c) => c.web?.uri).filter((u): u is string => typeof u === "string" && u.length > 0))
  );

  if (!answerText.trim()) {
    throw new Error("Gemini grounded search returned no answer text");
  }
  return { answerText, groundedUrls };
}

const offerResponseSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      store: { type: Type.STRING },
      price: { type: Type.NUMBER },
      url: { type: Type.STRING },
      originalCurrency: { type: Type.STRING },
      shipping: { type: Type.STRING },
      rating: { type: Type.NUMBER },
    },
    required: ["store", "price", "url"],
  },
};

async function runStructuredExtraction(
  ai: GoogleGenAI,
  model: string,
  query: NormalizedQuery,
  grounded: GroundedSearchResult
): Promise<unknown> {
  const prompt = `Product: "${query.query}"

Web search summary:
${grounded.answerText}

Extract the offers mentioned above as JSON matching the response schema. Rules:
- The "url" field MUST be copied verbatim from this list — never modify a URL or invent a new one:
${grounded.groundedUrls.map((u) => `  ${u}`).join("\n")}
- If a price isn't in USD, set "originalCurrency" to its 3-letter currency code.
- Only include offers you're actually confident about from the summary above; do not add offers from your own general knowledge.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: offerResponseSchema,
      },
    }),
    CALL_TIMEOUT_MS,
    "Gemini structured extraction"
  );

  const text = response.text ?? "";
  if (!text.trim()) {
    throw new Error("Gemini structured extraction returned no text");
  }
  return JSON.parse(text);
}

interface RawExtractedOffer {
  store?: unknown;
  price?: unknown;
  url?: unknown;
  originalCurrency?: unknown;
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
 * Exported for unit testing: validates and filters raw extracted offers down to
 * ones that (a) use a URL actually present in call 1's grounding chunks — never
 * one Gemini invented — and (b) resolve to an allow-listed retailer domain.
 */
export function filterGroundedOffers(rawOffers: unknown, groundedUrls: string[]): ValidatedOffer[] {
  if (!Array.isArray(rawOffers)) return [];
  const groundedSet = new Set(groundedUrls);
  const results: ValidatedOffer[] = [];

  for (const item of rawOffers as RawExtractedOffer[]) {
    if (typeof item !== "object" || item === null) continue;
    if (typeof item.store !== "string" || item.store.trim().length === 0) continue;
    if (typeof item.price !== "number" || !(item.price > 0)) continue;
    if (typeof item.url !== "string") continue;
    if (!groundedSet.has(item.url)) continue; // must be a real grounded citation, not invented
    if (!isTrustedVendorUrl(item.url)) continue; // must resolve to an allow-listed retailer

    results.push({
      store: item.store,
      price: item.price,
      url: item.url,
      currency:
        typeof item.originalCurrency === "string" && item.originalCurrency.trim().length > 0
          ? item.originalCurrency.trim().toUpperCase()
          : "USD",
      shipping: typeof item.shipping === "string" ? item.shipping : undefined,
      rating: typeof item.rating === "number" ? item.rating : undefined,
    });
  }

  return results;
}

export class GeminiPriceProvider implements PriceProvider {
  readonly name = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async searchWithModel(model: string, query: NormalizedQuery): Promise<Offer[]> {
    const grounded = await runGroundedSearch(this.ai, model, query);
    if (grounded.groundedUrls.length === 0) {
      throw new Error("Gemini grounded search returned no source URLs");
    }

    const rawExtracted = await runStructuredExtraction(this.ai, model, query, grounded);
    const validated = filterGroundedOffers(rawExtracted, grounded.groundedUrls);
    if (validated.length === 0) {
      throw new Error("No trusted, grounded offers survived filtering");
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

    return offers.sort((a, b) => a.price - b.price).slice(0, MAX_OFFERS);
  }

  async search(query: NormalizedQuery): Promise<Offer[]> {
    try {
      return await this.searchWithModel(PRIMARY_MODEL, query);
    } catch (err) {
      if (!isModelUnavailableError(err)) {
        throw err;
      }
      // Primary model id unavailable in this project/region — retry once with the coded fallback.
      return await this.searchWithModel(FALLBACK_MODEL, query);
    }
  }
}
