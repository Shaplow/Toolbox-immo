"use client";

/**
 * PublishSection — section "Publication" de la fiche.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - Header section uniformisé : icône Send + titre Geist + Badge success si publié.
 * - Inputs natifs URL → <FormField> + <Input icon={ExternalLink}> (cohérent forms).
 * - Erreurs portées par FormField (plus de <p> séparé).
 * - Success → toast.success (au lieu de message inline qui disparaît au refresh).
 * - Warning incompleteSteps reste amber (warning légitime, pattern Banner local).
 * - 3 boutons custom → Button primary / Button ghost (Corriger) / Button secondary (Annuler).
 * - Lien URL publié en gris mono (lien externe sobre, plus indigo).
 * - "URL non renseignée" : text gray-400 sans italic (lisibilité).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, ExternalLink, Edit2, CheckCircle, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";

interface Props {
  slot: {
    id: string;
    status: string;
    publishedUrl: string | null;
    publishedAt: Date | null;
  };
  /** true pour CM assigné et ADMIN */
  canPublish: boolean;
  /** Steps "amont" pas encore terminées au moment du rendu. */
  incompleteSteps?: Array<{ key: string; label: string; status: "todo" | "failed" }>;
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

export function PublishSection({ slot, canPublish, incompleteSteps = [] }: Props) {
  const router = useRouter();
  const isPublished = slot.status === "PUBLISHED";

  const [url, setUrl] = useState(slot.publishedUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [correctedUrl, setCorrectedUrl] = useState(slot.publishedUrl ?? "");
  const [correcting, setCorrecting] = useState(false);

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
      toast.success("Publication marquée — ✓");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      toast.error(msg);
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
      toast.success("URL corrigée.");
      setEditingUrl(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setError(msg);
      toast.error(msg);
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <section
      id="publish"
      className="bg-white border border-gray-100 rounded-2xl p-8"
    >
      {/* En-tête section */}
      <div className="flex items-center gap-2 mb-4">
        <Send size={14} className="text-gray-500" />
        <h2 className="text-[13px] font-semibold text-gray-950">Publication</h2>
        {isPublished && (
          <Badge variant="success" icon={CheckCircle}>
            publié
          </Badge>
        )}
      </div>

      {/* ── État publié ────────────────────────────────────────────── */}
      {isPublished && (
        <div className="space-y-4">
          {/* URL publiée */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
              Lien Instagram
            </p>
            {slot.publishedUrl ? (
              <a
                href={slot.publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 hover:text-gray-950 break-all transition-colors"
              >
                <ExternalLink size={13} className="flex-shrink-0" />
                {slot.publishedUrl}
              </a>
            ) : (
              <p className="text-[13px] text-gray-400">URL non renseignée</p>
            )}
          </div>

          {/* Date de publication */}
          {slot.publishedAt && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
                Date de publication
              </p>
              <p className="text-[13px] text-gray-700">{formatDateTimeFR(slot.publishedAt)}</p>
            </div>
          )}

          {/* Correction URL (canPublish uniquement) */}
          {canPublish && (
            <div className="pt-3 border-t border-gray-100">
              {!editingUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Edit2}
                  onClick={() => setEditingUrl(true)}
                >
                  Corriger l&apos;URL
                </Button>
              ) : (
                <div className="space-y-3">
                  <FormField label="URL corrigée" error={error ?? undefined}>
                    <Input
                      type="url"
                      value={correctedUrl}
                      onChange={(v) => {
                        setCorrectedUrl(v);
                        setError(null);
                      }}
                      icon={ExternalLink}
                      placeholder="https://www.instagram.com/p/..."
                    />
                  </FormField>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      icon={CheckCircle}
                      onClick={handleCorrectUrl}
                      loading={correcting}
                    >
                      Valider
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      onClick={() => {
                        setEditingUrl(false);
                        setError(null);
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Non publié + rôle sans canPublish (info read-only) ──────── */}
      {!isPublished && !canPublish && (
        <p className="text-[13px] text-gray-500 leading-relaxed">
          La publication sera marquée par le CM assigné une fois le contenu posté
          sur Instagram.
        </p>
      )}

      {/* ── Non publié + canPublish (action principale) ─────────────── */}
      {!isPublished && canPublish && (
        <div className="space-y-4">
          {/* Warning si étapes amont incomplètes */}
          {incompleteSteps.length > 0 && (
            <div className="flex items-start gap-2 text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium leading-tight">
                  {incompleteSteps.length === 1
                    ? "Une étape n'est pas finalisée"
                    : `${incompleteSteps.length} étapes ne sont pas finalisées`}{" "}
                  : {incompleteSteps.map((s) => s.label).join(", ")}.
                </p>
                <p className="text-[12px] text-amber-800/80 mt-0.5 leading-relaxed">
                  Tu peux quand même marquer publié — vérifie juste que c&apos;est
                  bien le contenu que tu veux figer.
                </p>
              </div>
            </div>
          )}

          <FormField
            label="URL Instagram"
            required
            help="Colle l'URL une fois la publication postée."
            error={error ?? undefined}
          >
            <Input
              type="url"
              value={url}
              onChange={(v) => {
                setUrl(v);
                setError(null);
              }}
              disabled={submitting}
              icon={ExternalLink}
              placeholder="https://www.instagram.com/p/..."
            />
          </FormField>

          <Button
            icon={CheckCircle}
            onClick={handleMarkPublished}
            loading={submitting}
            disabled={!url.trim()}
          >
            Marquer publié
          </Button>
        </div>
      )}
    </section>
  );
}
