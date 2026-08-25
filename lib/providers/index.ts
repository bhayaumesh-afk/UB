import { mockProvider } from "./mock";
import { SerpApiPriceProvider } from "./serpapi";
import { VertexGeminiPriceProvider } from "./gemini";
import type { PriceProvider } from "./types";

/**
 * Selects the active price provider, in priority order:
 * 1. SerpApi (SERPAPI_KEY) — structured Google Shopping feed, most reliable.
 * 2. Vertex AI Gemini + Google Search grounding (GOOGLE_VERTEX_CREDENTIALS_JSON) —
 *    lower-confidence AI-summarized prices, used as a live fallback when SerpApi
 *    isn't configured.
 * 3. Deterministic mock provider (demo mode).
 */
export function getPriceProvider(env: NodeJS.ProcessEnv = process.env): PriceProvider {
  const serpKey = env.SERPAPI_KEY;
  if (serpKey && serpKey.trim().length > 0) {
    return new SerpApiPriceProvider(serpKey);
  }
  const vertexCreds = env.GOOGLE_VERTEX_CREDENTIALS_JSON;
  if (vertexCreds && vertexCreds.trim().length > 0) {
    return new VertexGeminiPriceProvider(vertexCreds, env.GOOGLE_VERTEX_LOCATION, env.GOOGLE_VERTEX_MODEL);
  }
  return mockProvider;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const hasSerp = Boolean(env.SERPAPI_KEY && env.SERPAPI_KEY.trim().length > 0);
  const hasVertex = Boolean(env.GOOGLE_VERTEX_CREDENTIALS_JSON && env.GOOGLE_VERTEX_CREDENTIALS_JSON.trim().length > 0);
  return !hasSerp && !hasVertex;
}

export type { PriceProvider } from "./types";
export { mockProvider } from "./mock";
export { SerpApiPriceProvider } from "./serpapi";
export { VertexGeminiPriceProvider } from "./gemini";
