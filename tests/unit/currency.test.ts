import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCurrencyCacheForTests, convertToUsd } from "@/lib/currency";

describe("convertToUsd", () => {
  beforeEach(() => {
    __resetCurrencyCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetCurrencyCacheForTests();
  });

  it("returns the amount unchanged for USD and marks it not converted", async () => {
    const result = await convertToUsd(100, "USD");
    expect(result).toEqual({ amountUsd: 100, converted: false });
  });

  it("is case-insensitive for the currency code", async () => {
    const result = await convertToUsd(100, "usd");
    expect(result).toEqual({ amountUsd: 100, converted: false });
  });

  it("converts a non-USD amount using the fetched rate", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", rates: { USD: 1, EUR: 0.92 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await convertToUsd(92, "EUR");
    expect(result.converted).toBe(true);
    expect(result.amountUsd).toBeCloseTo(100, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches rates across calls within the TTL window", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", rates: { USD: 1, EUR: 0.92 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await convertToUsd(92, "EUR");
    await convertToUsd(46, "EUR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws for an unknown currency code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "success", rates: { USD: 1, EUR: 0.92 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(convertToUsd(10, "ZZZ")).rejects.toThrow();
  });

  it("propagates an error when the FX API fails and no cache exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(convertToUsd(10, "EUR")).rejects.toThrow();
  });
});
