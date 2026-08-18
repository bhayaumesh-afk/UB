import { describe, expect, it } from "vitest";
import { getPriceProvider, isDemoMode } from "@/lib/providers";
import { mockProvider, selectMockCategory } from "@/lib/providers/mock";
import { SerpApiPriceProvider } from "@/lib/providers/serpapi";
import type { NormalizedQuery } from "@/types";

describe("provider selection", () => {
  it("falls back to the mock provider when SERPAPI_KEY is unset", () => {
    const provider = getPriceProvider({} as unknown as NodeJS.ProcessEnv);
    expect(provider.name).toBe("mock");
    expect(isDemoMode({} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("falls back to the mock provider when SERPAPI_KEY is empty", () => {
    const provider = getPriceProvider({ SERPAPI_KEY: "  " } as unknown as NodeJS.ProcessEnv);
    expect(provider.name).toBe("mock");
  });

  it("selects the SerpApi provider when SERPAPI_KEY is set", () => {
    const provider = getPriceProvider({ SERPAPI_KEY: "abc123" } as unknown as NodeJS.ProcessEnv);
    expect(provider.name).toBe("serpapi");
    expect(provider).toBeInstanceOf(SerpApiPriceProvider);
    expect(isDemoMode({ SERPAPI_KEY: "abc123" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

function query(q: string): NormalizedQuery {
  return { query: q, title: q, confidence: 1 };
}

describe("mock provider", () => {
  it("returns offers sorted ascending by price", async () => {
    const offers = await mockProvider.search(query("wireless headphones"));
    expect(offers.length).toBeGreaterThan(1);
    for (let i = 1; i < offers.length; i++) {
      expect(offers[i].price).toBeGreaterThanOrEqual(offers[i - 1].price);
    }
  });

  it("maps known keywords to their dedicated category", () => {
    expect(selectMockCategory(query("Sony noise cancelling headphones"))?.id).toBe("headphones");
    expect(selectMockCategory(query("Nike running sneakers"))?.id).toBe("sneakers");
    expect(selectMockCategory(query("Nespresso espresso machine"))?.id).toBe("coffee-maker");
  });

  it("falls back to generic offers for unmatched queries", async () => {
    expect(selectMockCategory(query("obscure gizmo widget"))).toBeNull();
    const offers = await mockProvider.search(query("obscure gizmo widget"));
    expect(offers.length).toBeGreaterThan(0);
  });

  it("is deterministic across repeated calls", async () => {
    const first = await mockProvider.search(query("wireless headphones"));
    const second = await mockProvider.search(query("wireless headphones"));
    expect(first).toEqual(second);
  });

  it("does not mutate its internal canned data between calls", async () => {
    const offers = await mockProvider.search(query("wireless headphones"));
    offers[0].price = -1;
    const again = await mockProvider.search(query("wireless headphones"));
    expect(again[0].price).not.toBe(-1);
  });
});
