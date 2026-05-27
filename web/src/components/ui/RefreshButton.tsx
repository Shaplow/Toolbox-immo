"use client";

/**
 * RefreshButton — bouton de refresh manuel pour les pages avec données
 * polling/SSE en arrière-plan.
 *
 * Le contenu est rafraîchi via `router.refresh()` (Next.js App Router)
 * qui re-fetch la page server side sans full reload. Le composant
 * affiche un spinner pendant 800ms pour donner un feedback visuel
 * (sinon le refresh est imperceptible sur connexions rapides).
 *
 * Utilisé sur les pages où le SSE/polling peut ne pas tout couvrir
 * (filter changes server side, items déjà completed before mount).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface Props {
  /** Titre tooltip pour l'icône. */
  title?: string;
  /** Variant compact (icône seule) ou expanded (icône + label). */
  variant?: "compact" | "expanded";
}

export function RefreshButton({
  title = "Rafraîchir",
  variant = "compact",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  function handleClick() {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
    });
    // Garde le spinner visible un minimum de 800ms pour donner un feedback
    // visible même sur connexion ultra-rapide.
    setTimeout(() => setSpinning(false), 800);
  }

  const isSpinning = spinning || pending;

  if (variant === "expanded") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isSpinning}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:opacity-50"
        title={title}
      >
        <RefreshCw size={13} className={isSpinning ? "animate-spin" : ""} />
        Rafraîchir
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSpinning}
      className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:opacity-50"
      title={title}
      aria-label={title}
    >
      <RefreshCw size={15} className={isSpinning ? "animate-spin" : ""} />
    </button>
  );
}
