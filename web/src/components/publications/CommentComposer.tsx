"use client";

/**
 * CommentComposer — formulaire d'ajout d'un nouveau commentaire.
 *
 * UX décisions Phase 3 :
 * - Textarea natif → <Textarea> primitive (focus ring mono).
 * - Bouton Envoyer indigo → <Button icon={Send}>.
 * - Erreur sous textarea → toast.error (au lieu de <p> inline).
 * - Help "Cmd+Entrée pour envoyer" → Kbd primitive (au lieu du
 *   placeholder qui obscurcit le textarea).
 * - Cmd+Enter (Mac) / Ctrl+Enter (Windows) raccourci préservé.
 */

import { useState, KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { KbdChord } from "@/components/ui/Kbd";
import { toast } from "@/components/ui/Toast";
import type { CommentData } from "./CommentItem";

interface CommentComposerProps {
  slotId: string;
  onCreated: (comment: CommentData) => void;
}

export function CommentComposer({ slotId, onCreated }: CommentComposerProps) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur inconnue");
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
    <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
      <Textarea
        value={body}
        onChange={(v) => setBody(v)}
        onKeyDown={handleKeyDown}
        placeholder="Ajouter un commentaire…"
        rows={3}
        disabled={submitting}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1.5">
          <KbdChord keys={["⌘", "↵"]} /> pour envoyer
        </span>
        <Button
          size="sm"
          icon={Send}
          onClick={() => void submit()}
          disabled={!body.trim()}
          loading={submitting}
        >
          Envoyer
        </Button>
      </div>
    </div>
  );
}
