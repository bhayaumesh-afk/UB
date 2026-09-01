import type { Offer } from "@/types";
import VerifiedRetailerBadge from "./VerifiedRetailerBadge";

export default function BestPriceCard({ offer }: { offer: Offer }) {
  return (
    <div
      data-testid="best-price-card"
      className="mb-6 rounded-xl border-2 border-brand-500 bg-brand-50 p-6 shadow-sm"
    >
      <div className="mb-2 inline-block rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
        Best price
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold text-slate-900">${offer.price.toFixed(2)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>
              at <span className="font-medium">{offer.store}</span>
              {offer.shipping ? ` · ${offer.shipping}` : ""}
            </span>
            <VerifiedRetailerBadge url={offer.url} />
          </div>
          {offer.originalCurrency && (
            <div className="mt-1 text-xs text-slate-500">
              converted from {offer.originalPrice?.toFixed(2)} {offer.originalCurrency}
            </div>
          )}
        </div>
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          View Deal
        </a>
      </div>
    </div>
  );
}
