"use client";

/**
 * CommentComposer — formulaire d'ajout d'un nouveau commentaire.
 *
 * - Textarea + bouton "Envoyer".
 * - Raccourci Cmd+Enter (Mac) / Ctrl+Enter (Windows).
 * - Bouton désactivé tant que body vide ou submit en cours.
 * - Affiche erreur API si POST échoue.
 */

import { useState, useRef, KeyboardEvent } from "react";
import type { CommentData } from "./CommentItem";

interface CommentComposerProps {
  slotId: string;
  onCreated: (comment: CommentData) => void;
}

export function CommentComposer({ slotId, onCreated }: CommentComposerProps) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/publications/${slotId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erreur lors de l'envoi");
      }
      const data = (await res.json()) as { comment: CommentData };
      onCreated(data.comment);
      setBody("");
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ajouter un commentaire… (Cmd+Entrée pour envoyer)"
        rows={3}
        disabled={submitting}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none placeholder:text-gray-400 disabled:opacity-60 transition-colors"
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => void submit()}
          disabled={!body.trim() || submitting}
          className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Envoi…" : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
