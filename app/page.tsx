"use client";

import { useState } from "react";
import Tabs from "@/components/Tabs";
import ImageInputTab from "@/components/ImageInputTab";
import NameInputTab from "@/components/NameInputTab";
import DescriptionInputTab from "@/components/DescriptionInputTab";
import CandidateChooser from "@/components/CandidateChooser";
import DemoModeBanner from "@/components/DemoModeBanner";
import BestPriceCard from "@/components/BestPriceCard";
import OfferList from "@/components/OfferList";
import type {
  IdentifyCandidate,
  IdentifyResponseBody,
  InputMode,
  NormalizedQuery,
  Offer,
  SearchPricesResponseBody,
} from "@/types";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "PriceScout";

type Phase = "idle" | "identifying" | "disambiguating" | "searching" | "results" | "error";

export default function HomePage() {
  const [mode, setMode] = useState<InputMode>("name");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<IdentifyCandidate[]>([]);
  const [identifiedTitle, setIdentifiedTitle] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  function resetResults() {
    setErrorMessage(null);
    setCandidates([]);
    setIdentifiedTitle(null);
    setOffers([]);
    setNotice(null);
  }

  async function runSearch(query: NormalizedQuery) {
    setPhase("searching");
    setIdentifiedTitle(query.title);
    try {
      const res = await fetch("/api/search-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data: SearchPricesResponseBody = await res.json();
      if (!data.ok) {
        setErrorMessage(data.error);
        setPhase("error");
        return;
      }
      setOffers(data.offers);
      setNotice(data.notice ?? null);
      setPhase("results");
    } catch {
      setErrorMessage("Could not reach the price search service. Please try again.");
      setPhase("error");
    }
  }

  async function identify(payload: {
    mode: InputMode;
    imageBase64?: string;
    imageMediaType?: string;
    name?: string;
    description?: string;
  }) {
    resetResults();
    setPhase("identifying");
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: IdentifyResponseBody = await res.json();
      if (!data.ok) {
        setErrorMessage(data.error);
        setPhase("error");
        return;
      }
      const { result } = data;
      if (result.confidence < 0.6 && result.candidates && result.candidates.length > 0) {
        setCandidates(result.candidates);
        setPhase("disambiguating");
        return;
      }
      await runSearch(result);
    } catch {
      setErrorMessage("Could not reach the product identification service. Please try again.");
      setPhase("error");
    }
  }

  function handleCandidateSelect(candidate: IdentifyCandidate) {
    const query: NormalizedQuery = {
      query: [candidate.brand, candidate.title].filter(Boolean).join(" "),
      title: candidate.title,
      brand: candidate.brand,
      category: candidate.category,
      confidence: 1,
    };
    setCandidates([]);
    runSearch(query);
  }

  const isBusy = phase === "identifying" || phase === "searching";
  const bestOffer = offers[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:py-16">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{appName}</h1>
        <p className="mt-2 text-slate-600">
          Upload a photo, type a product name, or describe an item — we&apos;ll find the best price.
        </p>
      </header>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Tabs
          active={mode}
          onChange={(m) => {
            setMode(m);
            resetResults();
            setPhase("idle");
          }}
        />
        <div className="mt-5">
          {mode === "image" && (
            <ImageInputTab
              disabled={isBusy}
              onSubmit={(base64, mediaType) =>
                identify({ mode: "image", imageBase64: base64, imageMediaType: mediaType })
              }
            />
          )}
          {mode === "name" && (
            <NameInputTab disabled={isBusy} onSubmit={(name) => identify({ mode: "name", name })} />
          )}
          {mode === "description" && (
            <DescriptionInputTab
              disabled={isBusy}
              onSubmit={(description) => identify({ mode: "description", description })}
            />
          )}
        </div>
      </section>

      {isBusy && (
        <div data-testid="loading" className="mb-6 text-center text-sm text-slate-500">
          {phase === "identifying" ? "Identifying product…" : "Searching for the best prices…"}
        </div>
      )}

      {phase === "error" && errorMessage && (
        <div
          role="alert"
          data-testid="error-message"
          className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {phase === "disambiguating" && candidates.length > 0 && (
        <CandidateChooser candidates={candidates} onSelect={handleCandidateSelect} />
      )}

      {phase === "results" && (
        <section>
          {identifiedTitle && (
            <p className="mb-4 text-sm text-slate-500">
              Results for <span className="font-medium text-slate-700">{identifiedTitle}</span>
            </p>
          )}
          {notice && <DemoModeBanner message={notice} />}
          {bestOffer ? (
            <>
              <BestPriceCard offer={bestOffer} />
              <OfferList offers={offers} />
            </>
          ) : (
            <p className="text-sm text-slate-500">No offers found for this product.</p>
          )}
        </section>
      )}
    </main>
  );
}
