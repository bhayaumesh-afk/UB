import { mockProvider } from "./mock";
import { SerpApiPriceProvider } from "./serpapi";
import { GeminiPriceProvider } from "./gemini";
import type { PriceProvider } from "./types";

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

/**
 * Selects the active price provider, in priority order:
 * 1. SerpApi (SERPAPI_KEY) — structured Google Shopping feed, most reliable.
 * 2. Gemini on Vertex AI + Google Search grounding (GCP_SERVICE_ACCOUNT_JSON) — live
 *    pricing with no paid SerpApi signup required, used when SerpApi isn't configured.
 *    Offer links are resolved and filtered through the trusted-vendor allow-list
 *    (see lib/trustedVendors.ts and lib/providers/gemini.ts).
 * 3. Deterministic mock provider (demo mode).
 */
export function getPriceProvider(env: NodeJS.ProcessEnv = process.env): PriceProvider {
  const serpKey = env.SERPAPI_KEY;
  if (hasValue(serpKey)) {
    return new SerpApiPriceProvider(serpKey!);
  }
  if (hasValue(env.GCP_SERVICE_ACCOUNT_JSON)) {
    return new GeminiPriceProvider(env.GCP_VERTEX_LOCATION);
  }
  return mockProvider;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const hasSerp = hasValue(env.SERPAPI_KEY);
  const hasGemini = hasValue(env.GCP_SERVICE_ACCOUNT_JSON);
  return !hasSerp && !hasGemini;
}

export type { PriceProvider } from "./types";
export { mockProvider } from "./mock";
export { SerpApiPriceProvider } from "./serpapi";
export { GeminiPriceProvider } from "./gemini";
