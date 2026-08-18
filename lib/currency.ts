// Free, no-key FX conversion via open.er-api.com, with a ~1hr in-memory cache
// so we don't hammer the FX API on every price search.

interface RateCacheEntry {
  rates: Record<string, number>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: RateCacheEntry | null = null;

async function getUsdRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      // Not user data, safe to cache at the fetch layer too.
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`FX API returned ${res.status}`);
    const data = (await res.json()) as { result: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) {
      throw new Error("FX API returned unsuccessful result");
    }
    cache = { rates: data.rates, fetchedAt: Date.now() };
    return cache.rates;
  } catch (err) {
    if (cache) {
      // Serve stale rates rather than fail the whole request.
      return cache.rates;
    }
    throw err;
  }
}

export interface ConversionResult {
  amountUsd: number;
  /** true if a live/cached FX rate was used to convert (i.e. currency wasn't already USD) */
  converted: boolean;
}

/**
 * Convert `amount` in `currency` to USD. Rates are USD-based (1 USD = rates[XXX]),
 * so converting XXX -> USD divides by rates[XXX].
 */
export async function convertToUsd(amount: number, currency: string): Promise<ConversionResult> {
  const code = currency.toUpperCase();
  if (code === "USD") {
    return { amountUsd: amount, converted: false };
  }
  const rates = await getUsdRates();
  const rate = rates[code];
  if (!rate || rate <= 0) {
    throw new Error(`No FX rate available for currency ${code}`);
  }
  return { amountUsd: amount / rate, converted: true };
}

/** Test-only helper to reset the module-level rate cache between test cases. */
export function __resetCurrencyCacheForTests() {
  cache = null;
}
