import { mockProvider } from "./mock";
import { SerpApiPriceProvider } from "./serpapi";
import { GeminiPriceProvider } from "./gemini";
import type { PriceProvider } from "./types";

/**
 * Selects the active price provider, in priority order:
 * 1. SerpApi (SERPAPI_KEY) — structured Google Shopping feed, most reliable.
 * 2. Gemini + Google Search grounding (GEMINI_API_KEY) — live pricing with no
 *    paid signup required, used when SerpApi isn't configured. Offer links are
 *    filtered through the trusted-vendor allow-list (see lib/trustedVendors.ts).
 * 3. Deterministic mock provider (demo mode).
 */
export function getPriceProvider(env: NodeJS.ProcessEnv = process.env): PriceProvider {
  const serpKey = env.SERPAPI_KEY;
  if (serpKey && serpKey.trim().length > 0) {
    return new SerpApiPriceProvider(serpKey);
  }
  const geminiKey = env.GEMINI_API_KEY;
  if (geminiKey && geminiKey.trim().length > 0) {
    return new GeminiPriceProvider(geminiKey);
  }
  return mockProvider;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const hasSerp = Boolean(env.SERPAPI_KEY && env.SERPAPI_KEY.trim().length > 0);
  const hasGemini = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0);
  return !hasSerp && !hasGemini;
}

export type { PriceProvider } from "./types";
export { mockProvider } from "./mock";
export { SerpApiPriceProvider } from "./serpapi";
export { GeminiPriceProvider } from "./gemini";
