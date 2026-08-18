"use client";

import type { InputMode } from "@/types";

const TABS: { mode: InputMode; label: string }[] = [
  { mode: "image", label: "Photo" },
  { mode: "name", label: "Product name" },
  { mode: "description", label: "Description" },
];

export default function Tabs({
  active,
  onChange,
}: {
  active: InputMode;
  onChange: (mode: InputMode) => void;
}) {
  return (
    <div role="tablist" aria-label="Product input method" className="flex gap-1 rounded-lg bg-slate-100 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          role="tab"
          type="button"
          aria-selected={active === tab.mode}
          data-testid={`tab-${tab.mode}`}
          onClick={() => onChange(tab.mode)}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.mode
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
