import { isTrustedVendorUrl } from "@/lib/trustedVendors";

/**
 * Documents the trusted-vendor guarantee to the user — offers reaching the UI have
 * already been filtered to allow-listed retailer domains (see lib/trustedVendors.ts),
 * so this doesn't gate anything further at render time.
 */
export default function VerifiedRetailerBadge({ url }: { url: string }) {
  if (!isTrustedVendorUrl(url)) return null;

  return (
    <span
      data-testid="verified-retailer-badge"
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
        <path
          fillRule="evenodd"
          d="M10 1.5c.28 0 .55.07.8.2l6 3.09c.61.31 1 .95 1 1.64v4.4c0 4.2-2.9 7.9-7 9.17-4.1-1.27-7-4.97-7-9.17v-4.4c0-.69.39-1.33 1-1.64l6-3.09c.25-.13.52-.2.8-.2Zm2.7 6.2a.75.75 0 0 0-1.06-.04L9 10.15l-1.14-1.1a.75.75 0 1 0-1.04 1.08l1.67 1.62a.75.75 0 0 0 1.05 0l3.16-3.05a.75.75 0 0 0 .04-1.06Z"
          clipRule="evenodd"
        />
      </svg>
      Verified retailer
    </span>
  );
}
