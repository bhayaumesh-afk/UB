import type { IdentifyCandidate } from "@/types";

export default function CandidateChooser({
  candidates,
  onSelect,
}: {
  candidates: IdentifyCandidate[];
  onSelect: (candidate: IdentifyCandidate) => void;
}) {
  return (
    <div data-testid="candidate-chooser" className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
      <p className="mb-3 text-sm font-medium text-slate-700">
        We&apos;re not fully sure which product you mean — pick the closest match:
      </p>
      <div className="flex flex-col gap-2">
        {candidates.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(c)}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-left text-sm hover:border-brand-500 hover:bg-brand-50"
          >
            <div className="font-medium text-slate-900">{c.title}</div>
            {(c.brand || c.category) && (
              <div className="text-xs text-slate-500">
                {[c.brand, c.category].filter(Boolean).join(" · ")}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
