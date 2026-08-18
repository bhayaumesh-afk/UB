import type { Offer } from "@/types";

export default function OfferList({ offers }: { offers: Offer[] }) {
  if (offers.length <= 1) return null;

  const rest = offers.slice(1);

  return (
    <div data-testid="offer-list" className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
      {rest.map((offer, i) => (
        <div
          key={`${offer.store}-${offer.url}-${i}`}
          data-testid="offer-row"
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div>
            <div className="font-medium text-slate-900">{offer.store}</div>
            <div className="text-sm text-slate-500">
              {offer.shipping ?? "Shipping info not available"}
              {offer.rating ? ` · ${offer.rating.toFixed(1)}★` : ""}
            </div>
            {offer.originalCurrency && (
              <div className="text-xs text-slate-400">
                converted from {offer.originalPrice?.toFixed(2)} {offer.originalCurrency}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-lg font-semibold text-slate-900">${offer.price.toFixed(2)}</span>
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-500 hover:text-brand-700"
            >
              View Deal
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
