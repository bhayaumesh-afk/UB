"use client";

import { useState } from "react";

export default function DescriptionInputTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (description: string) => void;
  disabled: boolean;
}) {
  const [description, setDescription] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (description.trim()) onSubmit(description.trim());
      }}
    >
      <label htmlFor="product-description-input" className="text-sm font-medium text-slate-700">
        Describe the product
      </label>
      <textarea
        id="product-description-input"
        data-testid="description-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        placeholder="e.g. Black over-ear noise-cancelling headphones, Sony, released 2022"
        className="resize-none rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="submit"
        data-testid="submit-description"
        disabled={disabled || !description.trim()}
        className="self-start rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Find prices
      </button>
    </form>
  );
}
