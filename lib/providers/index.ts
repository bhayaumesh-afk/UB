import { mockProvider } from "./mock";
import { SerpApiPriceProvider } from "./serpapi";
import type { PriceProvider } from "./types";

/**
 * Selects the active price provider: SerpApi when SERPAPI_KEY is configured,
 * otherwise the deterministic mock provider (demo mode).
 */
export function getPriceProvider(env: NodeJS.ProcessEnv = process.env): PriceProvider {
  const key = env.SERPAPI_KEY;
  if (key && key.trim().length > 0) {
    return new SerpApiPriceProvider(key);
  }
  return mockProvider;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.SERPAPI_KEY || env.SERPAPI_KEY.trim().length === 0;
}

export type { PriceProvider } from "./types";
export { mockProvider } from "./mock";
export { SerpApiPriceProvider } from "./serpapi";
