import { describe, expect, it } from "vitest";
import { TRUSTED_VENDOR_DOMAINS, isTrustedVendorUrl } from "@/lib/trustedVendors";

describe("isTrustedVendorUrl", () => {
  it("matches an exact domain", () => {
    expect(isTrustedVendorUrl("https://amazon.com/dp/B09JPK9K1J")).toBe(true);
  });

  it("matches a www subdomain", () => {
    expect(isTrustedVendorUrl("https://www.amazon.com/dp/B09JPK9K1J")).toBe(true);
  });

  it("matches an arbitrary subdomain", () => {
    expect(isTrustedVendorUrl("https://smile.amazon.com/dp/B09JPK9K1J")).toBe(true);
  });

  it("matches every domain in the allow-list at least via a www subdomain", () => {
    for (const domain of TRUSTED_VENDOR_DOMAINS) {
      expect(isTrustedVendorUrl(`https://www.${domain}/product/123`)).toBe(true);
    }
  });

  it("rejects a look-alike domain that merely contains the trusted domain as a prefix", () => {
    expect(isTrustedVendorUrl("https://amazon.com.evil.tld/dp/x")).toBe(false);
  });

  it("rejects a look-alike domain with the trusted name embedded elsewhere", () => {
    expect(isTrustedVendorUrl("https://not-amazon.com/dp/x")).toBe(false);
    expect(isTrustedVendorUrl("https://amazon.com.br.attacker.net/dp/x")).toBe(false);
  });

  it("rejects an untrusted retailer entirely", () => {
    expect(isTrustedVendorUrl("https://sketchy-deals.example/dp/x")).toBe(false);
  });

  it("is case-insensitive on the hostname", () => {
    expect(isTrustedVendorUrl("https://WWW.AMAZON.COM/dp/x")).toBe(true);
  });

  it("returns false, never throws, for an invalid URL", () => {
    expect(() => isTrustedVendorUrl("not a url")).not.toThrow();
    expect(isTrustedVendorUrl("not a url")).toBe(false);
    expect(isTrustedVendorUrl("")).toBe(false);
    expect(isTrustedVendorUrl("ftp:///")).toBe(false);
  });

  it("returns false for a non-http(s) scheme pointing at a trusted-looking host", () => {
    // Still parses as a valid URL (hostname is empty for this form), must not match.
    expect(isTrustedVendorUrl("javascript:alert(1)")).toBe(false);
  });
});
