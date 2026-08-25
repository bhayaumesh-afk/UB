// Allow-list of retailer domains an offer link is permitted to point to. This is the
// safety gate for any provider whose links come from open web search / a generative
// model (see lib/providers/gemini.ts) rather than a fully structured, licensed feed.

export const TRUSTED_VENDOR_DOMAINS = [
  "amazon.com",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "ebay.com",
  "costco.com",
  "newegg.com",
  "homedepot.com",
  "apple.com",
  "samsung.com",
  "bhphotovideo.com",
  "adorama.com",
];

/**
 * True if `url`'s hostname is an allow-listed domain or a subdomain of one
 * (e.g. "www.amazon.com" and "smile.amazon.com" both match "amazon.com").
 * A look-alike like "amazon.com.evil.tld" must NOT match. Never throws —
 * an invalid URL simply returns false.
 */
export function isTrustedVendorUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;

  return TRUSTED_VENDOR_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}
