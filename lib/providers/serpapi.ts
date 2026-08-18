import type { NormalizedQuery, Offer } from "@/types";
import { convertToUsd } from "@/lib/currency";
import type { PriceProvider } from "./types";

// Live price source via SerpApi's Google Shopping engine.
// https://serpapi.com/google-shopping-api
// We deliberately do NOT scrape retailer HTML directly — SerpApi is a licensed
// aggregator and is the only live price source this app uses.

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const REQUEST_TIMEOUT_MS = 8000;

interface SerpApiShoppingResult {
  title?: string;
  source?: string;
  link?: string;
  product_link?: string;
  thumbnail?: string;
  extracted_price?: number;
  price?: string;
  currency?: string;
  delivery?: string;
  rating?: number;
}

interface SerpApiResponse {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
}

function parseCurrencyFromPriceString(priceStr: string | undefined): string {
  if (!priceStr) return "USD";
  if (priceStr.includes("$")) return "USD";
  if (priceStr.includes("€")) return "EUR";
  if (priceStr.includes("£")) return "GBP";
  if (priceStr.includes("¥")) return "JPY";
  return "USD";
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SerpApiPriceProvider implements PriceProvider {
  readonly name = "serpapi" as const;

  constructor(private readonly apiKey: string) {}

  async search(query: NormalizedQuery): Promise<Offer[]> {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q: query.query,
      api_key: this.apiKey,
      hl: "en",
      gl: "us",
    });

    const res = await fetchWithTimeout(`${SERPAPI_ENDPOINT}?${params.toString()}`, REQUEST_TIMEOUT_MS);
    if (!res.ok) {
      throw new Error(`SerpApi returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as SerpApiResponse;
    if (data.error) {
      throw new Error(`SerpApi error: ${data.error}`);
    }

    const results = data.shopping_results ?? [];
    const offers: Offer[] = [];

    for (const r of results) {
      if (!r.title || r.extracted_price == null || !(r.link || r.product_link)) continue;
      const currency = r.currency || parseCurrencyFromPriceString(r.price);
      let priceUsd = r.extracted_price;
      let originalCurrency: string | undefined;
      let originalPrice: number | undefined;
      try {
        const conversion = await convertToUsd(r.extracted_price, currency);
        priceUsd = conversion.amountUsd;
        if (conversion.converted) {
          originalCurrency = currency;
          originalPrice = r.extracted_price;
        }
      } catch {
        // If FX conversion fails, skip this offer rather than show a wrong price.
        continue;
      }

      offers.push({
        store: r.source || "Unknown store",
        price: Math.round(priceUsd * 100) / 100,
        originalCurrency,
        originalPrice,
        url: r.link || r.product_link!,
        thumbnail: r.thumbnail,
        shipping: r.delivery,
        rating: r.rating,
      });
    }

    return offers.sort((a, b) => a.price - b.price);
  }
}
