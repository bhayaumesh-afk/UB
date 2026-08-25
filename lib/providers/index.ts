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
 * 2. Gemini + Google Search grounding — live pricing with no paid signup required,
 *    used when SerpApi isn't configured. Authenticates via GOOGLE_VERTEX_CREDENTIALS_JSON
 *    (Vertex AI service account, takes priority if both are set) or GEMINI_API_KEY
 *    (Gemini Developer API key). Offer links are filtered through the trusted-vendor
 *    allow-list (see lib/trustedVendors.ts).
 * 3. Deterministic mock provider (demo mode).
 */
export function getPriceProvider(env: NodeJS.ProcessEnv = process.env): PriceProvider {
  const serpKey = env.SERPAPI_KEY;
  if (hasValue(serpKey)) {
    return new SerpApiPriceProvider(serpKey!);
  }
  const credentialsJson = env.GOOGLE_VERTEX_CREDENTIALS_JSON;
  const geminiApiKey = env.GEMINI_API_KEY;
  if (hasValue(credentialsJson) || hasValue(geminiApiKey)) {
    return new GeminiPriceProvider({
      credentialsJson: hasValue(credentialsJson) ? credentialsJson : undefined,
      apiKey: hasValue(geminiApiKey) ? geminiApiKey : undefined,
      location: env.GOOGLE_VERTEX_LOCATION,
    });
  }
  return mockProvider;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const hasSerp = hasValue(env.SERPAPI_KEY);
  const hasGemini = hasValue(env.GOOGLE_VERTEX_CREDENTIALS_JSON) || hasValue(env.GEMINI_API_KEY);
  return !hasSerp && !hasGemini;
}

export type { PriceProvider } from "./types";
export { mockProvider } from "./mock";
export { SerpApiPriceProvider } from "./serpapi";
export { GeminiPriceProvider } from "./gemini";
