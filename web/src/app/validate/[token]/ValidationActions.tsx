"use client";

/**
 * Boutons d'action pour le client externe :
 *  - Valider (toujours)
 *  - Demander modifications (si allowsRevision)
 *  - Annuler complètement (toujours)
 *
 * POST vers /api/validate/[token] avec body { action, comment? }.
 * Sur succès, recharge la page pour afficher l'état résolu.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquare, X } from "lucide-react";

interface Props {
  token: string;
  allowsRevision: boolean;
}

type ActionType = "approve" | "reject" | "cancel";

export function ValidationActions({ token, allowsRevision }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [comment, setComment] = useState("");

  async function submit(action: ActionType, body?: { comment?: string }) {
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch(`/api/validate/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      // Recharger pour afficher l'état résolu
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setSubmitting(null);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold text-gray-700">Votre décision</h3>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* ── Approve ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => submit("approve")}
        disabled={submitting !== null}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Check size={16} />
        {submitting === "approve" ? "Validation en cours…" : "Valider la publication"}
      </button>

      {/* ── Reject (avec commentaire, si allowsRevision) ──────────────────── */}
      {allowsRevision && (
        <>
          {!showRejectForm ? (
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              disabled={submitting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-amber-300 bg-peach-50 text-peach-800 font-medium hover:bg-peach-100 disabled:opacity-50 transition-colors"
            >
              <MessageSquare size={16} />
              Demander des modifications
            </button>
          ) : (
            <div className="space-y-3 border border-peach-200 rounded-lg p-3 bg-peach-50/50">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">
                  Décrivez les modifications souhaitées
                </span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Ex : Pouvez-vous changer la musique et corriger la faute sur le prix ?"
                  className="mt-1 w-full min-h-[100px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  maxLength={2000}
                />
                <span className="text-xs text-gray-400">{comment.length} / 2000</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(false);
                    setComment("");
                  }}
                  disabled={submitting !== null}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => submit("reject", { comment: comment.trim() })}
                  disabled={submitting !== null || !comment.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting === "reject" ? "Envoi…" : "Envoyer la demande"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Cancel (toujours) ─────────────────────────────────────────────── */}
      {!showCancelConfirm ? (
        <button
          type="button"
          onClick={() => setShowCancelConfirm(true)}
          disabled={submitting !== null}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <X size={16} />
          {allowsRevision
            ? "Annuler complètement la publication"
            : "Refuser et annuler la publication"}
        </button>
      ) : (
        <div className="space-y-3 border border-red-200 rounded-lg p-3 bg-red-50/50">
          <p className="text-sm text-red-800">
            La publication sera <strong>définitivement annulée</strong>. Cette action
            ne peut pas être annulée par vous.
          </p>
          <label className="block">
            <span className="text-xs text-gray-600">Commentaire optionnel</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Raison de l'annulation (optionnel)"
              className="mt-1 w-full min-h-[60px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              maxLength={2000}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCancelConfirm(false);
                setComment("");
              }}
              disabled={submitting !== null}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Retour
            </button>
            <button
              type="button"
              onClick={() => submit("cancel", { comment: comment.trim() || undefined })}
              disabled={submitting !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {submitting === "cancel" ? "Annulation…" : "Confirmer l'annulation"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
