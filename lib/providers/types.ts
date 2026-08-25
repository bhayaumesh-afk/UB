import type { NormalizedQuery, Offer } from "@/types";

export interface PriceProvider {
  /** Provider name, surfaced to the client as `source`. */
  readonly name: "serpapi" | "gemini" | "mock";
  /** Search for offers matching the normalized query. Should throw on hard failure. */
  search(query: NormalizedQuery): Promise<Offer[]>;
}
