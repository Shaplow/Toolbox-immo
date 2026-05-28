"use client";

/**
 * PublishSection — section "Publication" de la fiche publication.
 *
 * Gère le marquage comme publié sur Instagram via POST /api/publications/[id]/mark-published.
 * Si le slot est déjà PUBLISHED, affiche l'URL et la date + permet de corriger l'URL.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CheckCircle, ExternalLink, Edit2, Check } from "lucide-react";

interface Props {
  slot: {
    id: string;
    status: string;
    publishedUrl: string | null;
    publishedAt: Date | null;
  };
  /** true pour CM assigné et ADMIN */
  canPublish: boolean;
}

function formatDateTimeFR(date: Date): string {
  return new Date(date).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PublishSection({ slot, canPublish }: Props) {
  const router = useRouter();
  const isPublished = slot.status === "PUBLISHED";

  const [url, setUrl] = useState(slot.publishedUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [correctedUrl, setCorrectedUrl] = useState(slot.publishedUrl ?? "");
  const [correcting, setCorrecting] = useState(false);
  const [corrected, setCorrected] = useState(false);

  async function handleMarkPublished() {
    if (!url.trim()) {
      setError("L'URL Instagram est requise.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${slot.id}/mark-published`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur lors du marquage");
      setSuccess(true);
      // Rafraîchit les server components sans rechargement full page
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCorrectUrl() {
    if (!correctedUrl.trim()) {
      setError("L'URL corrigée est requise.");
      return;
    }
    setCorrecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/publications/${slot.id}/mark-published`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: correctedUrl.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la correction");
      setCorrected(true);
      setEditingUrl(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <section id="publish" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center gap-2 mb-4">
        <Send size={16} className="text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-700">Publication</h2>
        {isPublished && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium bg-green-50 text-green-700 border-green-200">
            <CheckCircle size={11} />
            Publié
          </span>
        )}
      </div>

      {/* Slot déjà publié */}
      {isPublished && (
        <div className="space-y-4">
          {/* URL publiée */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lien Instagram</p>
            {slot.publishedUrl ? (
              <a
                href={slot.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 break-all transition-colors"
              >
                <ExternalLink size={13} className="flex-shrink-0" />
                {slot.publishedUrl}
              </a>
            ) : (
              <p className="text-sm text-gray-400 italic">URL non renseignée</p>
            )}
          </div>

          {/* Date de publication */}
          {slot.publishedAt && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date de publication</p>
              <p className="text-sm text-gray-600">{formatDateTimeFR(slot.publishedAt)}</p>
            </div>
          )}

          {/* Correction URL (canPublish uniquement) */}
          {canPublish && (
            <div className="pt-2 border-t border-gray-50">
              {!editingUrl ? (
                <button
                  type="button"
                  onClick={() => setEditingUrl(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <Edit2 size={12} />
                  Corriger l&apos;URL
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500">URL corrigée</label>
                  <input
                    type="url"
                    value={correctedUrl}
                    onChange={(e) => {
                      setCorrectedUrl(e.target.value);
                      setCorrected(false);
                    }}
                    placeholder="https://www.instagram.com/p/..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
                  />
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCorrectUrl}
                      disabled={correcting}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50"
                    >
                      {corrected ? <Check size={14} /> : <Check size={14} />}
                      {correcting ? "Correction…" : "Valider"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingUrl(false); setError(null); }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slot non encore publié — lecture seule informative pour les rôles
          sans canPublish (ex. ADMIN qui regarde un slot dont il n'est pas CM
          assigné). Pas de champ grisé + erreur de permission qui donne
          l'impression d'un bug. */}
      {!isPublished && !canPublish && (
        <p className="text-sm text-gray-500">
          La publication sera marquée par le CM assigné une fois le contenu
          posté sur Instagram.
        </p>
      )}

      {!isPublished && canPublish && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Collez l&apos;URL Instagram de la publication une fois postée pour marquer ce slot comme publié.
          </p>

          <div className="space-y-2">
            <label htmlFor={`publish-url-${slot.id}`} className="text-xs font-medium text-gray-600">
              URL Instagram
            </label>
            <input
              id={`publish-url-${slot.id}`}
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              disabled={submitting}
              placeholder="https://www.instagram.com/p/..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {success && (
            <p className="text-xs text-green-600">Publication marquée — rechargement en cours…</p>
          )}

          <button
            type="button"
            onClick={handleMarkPublished}
            disabled={submitting || !url.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle size={15} />
            {submitting ? "Marquage…" : "Marquer publié"}
          </button>
        </div>
      )}
    </section>
  );
}
