"use client";

/**
 * Renders Google's required attribution widget for Google Search grounding
 * (groundingMetadata.searchEntryPoint.renderedContent) in its own container,
 * unmodified — a condition of using grounded search results, not decorative.
 */
export default function SearchAttribution({ html }: { html: string }) {
  return (
    <div
      data-testid="search-attribution"
      className="mb-4"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
