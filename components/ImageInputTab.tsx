"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/image";

export default function ImageInputTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (base64: string, mediaType: string) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [pending, setPending] = useState<{ base64: string; mediaType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setCompressing(true);
    try {
      const compressed = await compressImage(file);
      setPreview(`data:${compressed.mediaType};base64,${compressed.base64}`);
      setPending(compressed);
    } catch {
      setError("Could not process that image. Please try a different file.");
    } finally {
      setCompressing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="product-image-input"
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center hover:border-brand-400"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected product preview" className="max-h-56 rounded-lg object-contain" />
        ) : (
          <>
            <span className="text-sm font-medium text-slate-700">Click to upload a product photo</span>
            <span className="mt-1 text-xs text-slate-500">JPEG, PNG, or WebP — auto-resized before upload</span>
          </>
        )}
        <input
          id="product-image-input"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="image-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        data-testid="submit-image"
        disabled={disabled || compressing || !pending}
        onClick={() => pending && onSubmit(pending.base64, pending.mediaType)}
        className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {compressing ? "Processing image…" : "Find prices"}
      </button>
    </div>
  );
}
