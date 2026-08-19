"use client";

import { useState } from "react";

export default function NameInputTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (name: string) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <label htmlFor="product-name-input" className="text-sm font-medium text-slate-700">
        Product name
      </label>
      <input
        id="product-name-input"
        data-testid="name-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sony WH-1000XM5 headphones"
        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <button
        type="submit"
        data-testid="submit-name"
        disabled={disabled || !name.trim()}
        className="self-start rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Find prices
      </button>
    </form>
  );
}
