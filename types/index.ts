// Shared data contracts for PriceScout, used by both API routes and client components.

export type InputMode = "image" | "name" | "description";

export interface IdentifyCandidate {
  title: string;
  brand?: string;
  category?: string;
}

export interface NormalizedQuery {
  /** Search-engine-ready query string, e.g. "Sony WH-1000XM5 wireless headphones black" */
  query: string;
  /** Human-readable product title */
  title: string;
  brand?: string;
  category?: string;
  /** 0..1 confidence that `query`/`title` correctly identify the product */
  confidence: number;
  /** Alternate candidates offered when confidence is low, for the user to disambiguate */
  candidates?: IdentifyCandidate[];
}

export interface IdentifyRequestBody {
  mode: InputMode;
  /** Base64-encoded image data (no data URL prefix) — required when mode === "image" */
  imageBase64?: string;
  /** MIME type of the image, e.g. "image/jpeg" — required when mode === "image" */
  imageMediaType?: string;
  /** Product name text — required when mode === "name" */
  name?: string;
  /** Free-text description — required when mode === "description" */
  description?: string;
}

export type IdentifyResponseBody =
  | { ok: true; result: NormalizedQuery }
  | { ok: false; error: string };

export interface Offer {
  store: string;
  /** Price converted to USD */
  price: number;
  /** Original currency code if the source price wasn't already USD, e.g. "EUR" */
  originalCurrency?: string;
  /** Original price in `originalCurrency`, before conversion */
  originalPrice?: number;
  url: string;
  thumbnail?: string;
  shipping?: string;
  rating?: number;
}

export interface SearchPricesRequestBody {
  query: NormalizedQuery | { query: string; title?: string };
}

export type SearchPricesResponseBody =
  | { ok: true; offers: Offer[]; source: "serpapi" | "mock"; demoMode: boolean; notice?: string }
  | { ok: false; error: string };
