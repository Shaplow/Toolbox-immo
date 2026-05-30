"use client";

/**
 * ActivityTimeline — historique d'activité d'un slot publication.
 *
 * - Affiche les activités les plus récentes en premier (newest first).
 * - Pagination "Charger plus" via GET /api/publications/[id]/activity?before=<ISO>.
 * - Mapping humain FR pour les types d'activité connus.
 * - Aucun dangerouslySetInnerHTML.
 */

import { useState } from "react";
import {
  Activity,
  UserCheck,
  Sparkles,
  Image as ImageIcon,
  AlignLeft,
  FileText,
  Check,
  MessageSquare,
  ClipboardEdit,
  Film,
  Trash2,
  Upload,
  Star,
  RotateCcw,
  ArrowRight,
  ShieldCheck,
  ShieldX,
  Circle,
} from "lucide-react";
import { STATUS_LABELS } from "@/lib/slots/statusLabels";
import type { SlotStatus } from "@/types/calendar";
import { Section } from "@/components/ui/molecules/Section";
import { EmptyState } from "@/components/ui/EmptyState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string; // ISO
  actor: { id: string; name: string | null } | null;
}

interface ActivityTimelineProps {
  slotId: string;
  initialActivities: ActivityItem[];
  initialHasMore: boolean;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} jours`;
  return new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(key: unknown): string {
  if (typeof key === "string" && key in STATUS_LABELS) {
    return STATUS_LABELS[key as SlotStatus];
  }
  return String(key ?? "?");
}

function activityLabel(type: string, payload: Record<string, unknown> | null): string {
  switch (type) {
    case "STATUS_CHANGED": {
      const from = statusLabel(payload?.from);
      const to = statusLabel(payload?.to);
      return `Statut changé : ${from} → ${to}`;
    }
    case "ASSIGNEE_CHANGED": {
      const field = String(payload?.field ?? "");
      const newAssignee = String(payload?.newAssigneeName ?? payload?.newAssigneeId ?? "?");
      return `Assignation changée : ${field} → ${newAssignee}`;
    }
    case "RENDER_COMPLETED":
      return "Rendu vidéo terminé";
    case "COVER_COMPLETED":
      return "Cover sélectionnée";
    case "CAPTIONS_COMPLETED":
      return "Sous-titres prêts";
    case "DESCRIPTION_COMPLETED":
      return "Description générée";
    case "PUBLISHED":
      return "Publié sur Instagram";
    case "COMMENT_ADDED":
      return "A ajouté un commentaire";
    // ── Rushes / versions / brief ──────────────────────────────────────────
    case "BRIEF_UPDATED": {
      const hasAttachment = payload?.hasAttachment === true;
      return hasAttachment ? "Brief mis à jour (pièce jointe)" : "Brief mis à jour";
    }
    case "RUSHES_UPLOADED": {
      const count = typeof payload?.count === "number" ? payload.count : 1;
      const fileName = typeof payload?.fileName === "string" ? ` · ${payload.fileName}` : "";
      return count === 1
        ? `Rush téléversé${fileName}`
        : `Rushes téléversés (${count})`;
    }
    case "RUSHES_DELETED": {
      const fileName = typeof payload?.fileName === "string" ? ` · ${payload.fileName}` : "";
      return `Rush supprimé${fileName}`;
    }
    case "VERSION_UPLOADED": {
      const vn = typeof payload?.versionNumber === "number" ? payload.versionNumber : "?";
      const fileName = typeof payload?.fileName === "string" ? ` · ${payload.fileName}` : "";
      return `V${vn} téléversée${fileName}`;
    }
    case "VERSION_PROMOTED": {
      const vn = typeof payload?.versionNumber === "number" ? payload.versionNumber : "?";
      return `V${vn} promue version courante`;
    }
    case "VERSION_DELETED": {
      const vn = typeof payload?.versionNumber === "number" ? payload.versionNumber : "?";
      return `V${vn} supprimée`;
    }
    case "VERSION_RESTORED": {
      const vn = typeof payload?.versionNumber === "number" ? payload.versionNumber : "?";
      return `V${vn} restaurée`;
    }
    case "CURRENT_VERSION_CHANGED": {
      const prev = typeof payload?.previousVersionNumber === "number"
        ? `V${payload.previousVersionNumber}`
        : (payload?.previousVersionId ? "V?" : "aucune");
      const next = typeof payload?.versionNumber === "number" ? `V${payload.versionNumber}` : "V?";
      return `Version courante : ${prev} → ${next}`;
    }
    // ── Client validation (W2) ────────────────────────────────────────────────
    case "CLIENT_VALIDATION_TOKEN_GENERATED":
      return "Lien de validation client envoyé";
    case "CLIENT_VALIDATION_TOKEN_REVOKED":
      return "Lien de validation client révoqué";
    case "CLIENT_VALIDATION_APPROVED": {
      const round = typeof payload?.roundNumber === "number" ? ` (round ${payload.roundNumber})` : "";
      return `Client : validé${round}`;
    }
    case "CLIENT_VALIDATION_REJECTED": {
      const round = typeof payload?.roundNumber === "number" ? ` (round ${payload.roundNumber})` : "";
      const comment = typeof payload?.comment === "string" && payload.comment
        ? ` — « ${payload.comment.slice(0, 80)}${payload.comment.length > 80 ? "…" : ""} »`
        : "";
      return `Client : modifications demandées${round}${comment}`;
    }
    case "CLIENT_VALIDATION_CANCELLED": {
      const round = typeof payload?.roundNumber === "number" ? ` (round ${payload.roundNumber})` : "";
      return `Client : annulé${round}`;
    }
    // ── Cover lifecycle ───────────────────────────────────────────────────────
    case "COVER_QUEUED": {
      const preset = typeof payload?.presetName === "string" ? ` (preset "${payload.presetName}")` : "";
      return `Cover auto démarrée${preset}`;
    }
    case "COVER_READY": {
      const count = typeof payload?.frameCount === "number" ? ` (${payload.frameCount} frames)` : "";
      return `Cover : frames prêtes${count} — en attente de sélection CM`;
    }
    case "COVER_FAILED": {
      const msg = typeof payload?.errorMsg === "string"
        ? ` — ${payload.errorMsg.slice(0, 80)}${payload.errorMsg.length > 80 ? "…" : ""}`
        : "";
      return `Cover : échec extraction${msg}`;
    }
    case "COVER_CONFIG_ERROR": {
      const reason = payload?.reason === "preset_not_found"
        ? ` (preset "${payload.presetName}" introuvable)`
        : payload?.reason === "missing_preset_name"
          ? " (aucun preset configuré)"
          : "";
      return `Cover : config invalide${reason}`;
    }
    default:
      return type;
  }
}

type ActivityIconProps = { type: string };

function ActivityIcon({ type }: ActivityIconProps) {
  // Doctrine mono : tout en gray-100/gray-600 par défaut. Accents
  // sémantiques (success / danger / amber) UNIQUEMENT sur les évènements
  // critiques (publication, suppression, refus, échec). L'icône Lucide
  // distinctive porte la sémantique — la couleur ne sert qu'à signaler
  // un état exceptionnel.
  const base = "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0";
  const neutral = `${base} bg-gray-100 text-gray-600`;
  const success = `${base} bg-success-50 text-success-700`;
  const danger = `${base} bg-danger-50 text-danger-700`;
  const warning = `${base} bg-amber-50 text-amber-700`;

  switch (type) {
    case "STATUS_CHANGED":
      return <span className={neutral} title="Statut"><Activity size={12} /></span>;
    case "ASSIGNEE_CHANGED":
      return <span className={neutral} title="Assignation"><UserCheck size={12} /></span>;
    case "RENDER_COMPLETED":
      return <span className={neutral} title="Rendu"><Sparkles size={12} /></span>;
    case "COVER_COMPLETED":
      return <span className={neutral} title="Cover"><ImageIcon size={12} /></span>;
    case "CAPTIONS_COMPLETED":
      return <span className={neutral} title="Sous-titres"><AlignLeft size={12} /></span>;
    case "DESCRIPTION_COMPLETED":
      return <span className={neutral} title="Description"><FileText size={12} /></span>;
    case "PUBLISHED":
      return <span className={success} title="Publié"><Check size={12} /></span>;
    case "COMMENT_ADDED":
      return <span className={neutral} title="Commentaire"><MessageSquare size={12} /></span>;
    // ── Rushes / versions / brief ──────────────────────────────────────────
    case "BRIEF_UPDATED":
      return <span className={neutral} title="Brief"><ClipboardEdit size={12} /></span>;
    case "RUSHES_UPLOADED":
      return <span className={neutral} title="Rush"><Film size={12} /></span>;
    case "RUSHES_DELETED":
      return <span className={danger} title="Rush supprimé"><Trash2 size={12} /></span>;
    case "VERSION_UPLOADED":
      return <span className={neutral} title="Version uploadée"><Upload size={12} /></span>;
    case "VERSION_PROMOTED":
      return <span className={success} title="Version promue"><Star size={12} /></span>;
    case "VERSION_DELETED":
      return <span className={danger} title="Version supprimée"><Trash2 size={12} /></span>;
    case "VERSION_RESTORED":
      return <span className={neutral} title="Version restaurée"><RotateCcw size={12} /></span>;
    case "CURRENT_VERSION_CHANGED":
      return <span className={neutral} title="Version courante changée"><ArrowRight size={12} /></span>;
    // ── Client validation ─────────────────────────────────────────────────
    case "CLIENT_VALIDATION_TOKEN_GENERATED":
      return <span className={neutral} title="Lien envoyé"><ShieldCheck size={12} /></span>;
    case "CLIENT_VALIDATION_TOKEN_REVOKED":
      return <span className={neutral} title="Lien révoqué"><ShieldX size={12} /></span>;
    case "CLIENT_VALIDATION_APPROVED":
      return <span className={success} title="Client a validé"><Check size={12} /></span>;
    case "CLIENT_VALIDATION_REJECTED":
      return <span className={warning} title="Modifications demandées"><MessageSquare size={12} /></span>;
    case "CLIENT_VALIDATION_CANCELLED":
      return <span className={danger} title="Annulé par client"><ShieldX size={12} /></span>;
    // ── Cover lifecycle ───────────────────────────────────────────────────
    case "COVER_QUEUED":
      return <span className={neutral} title="Cover lancée"><ImageIcon size={12} /></span>;
    case "COVER_READY":
      return <span className={neutral} title="Cover prête"><ImageIcon size={12} /></span>;
    case "COVER_FAILED":
      return <span className={danger} title="Cover échouée"><Trash2 size={12} /></span>;
    case "COVER_CONFIG_ERROR":
      return <span className={warning} title="Cover : config invalide"><Circle size={10} /></span>;
    default:
      return <span className={neutral} title={type}><Circle size={10} /></span>;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityTimeline({
  slotId,
  initialActivities,
  initialHasMore,
  sectionId = "activity",
  storageKey,
  defaultOpen = false,
  collapsible = true,
}: ActivityTimelineProps) {
  const [activities, setActivities] = useState<ActivityItem[]>(initialActivities);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!hasMore || loading) return;
    const oldest = activities[activities.length - 1];
    if (!oldest) return;

    setLoading(true);
    setError(null);

    try {
      const url = `/api/publications/${slotId}/activity?limit=30&before=${encodeURIComponent(oldest.createdAt)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = (await res.json()) as { items: ActivityItem[]; hasMore: boolean };
      setActivities((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section
      title="Historique d'activité"
      icon={Activity}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        activities.length > 0 ? (
          <span className="text-xs text-gray-400 tabular-nums">{activities.length}</span>
        ) : null
      }
    >
      {activities.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Aucune activité"
          description="Les actions sur ce slot apparaîtront ici."
        />
      ) : (
        <ol className="space-y-3">
          {activities.map((item) => {
            const label = activityLabel(item.type, item.payload);
            const actorName = item.actor?.name ?? "Système";
            const publishedUrl =
              item.type === "PUBLISHED" && typeof item.payload?.url === "string"
                ? item.payload.url
                : null;
            const commentExcerpt =
              item.type === "COMMENT_ADDED" && typeof item.payload?.excerpt === "string"
                ? item.payload.excerpt
                : null;

            return (
              <li key={item.id} className="flex gap-3 items-start text-sm">
                <ActivityIcon type={item.type} />
                <div className="flex-1 min-w-0">
                  <span className="text-gray-800">
                    <span className="font-medium">{actorName}</span>{" "}
                    {label}
                    {publishedUrl && (
                      <>
                        {" "}—{" "}
                        <a
                          href={publishedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          Voir
                        </a>
                      </>
                    )}
                    {commentExcerpt && (
                      <span className="ml-1 text-gray-500 italic truncate">
                        «{commentExcerpt}»
                      </span>
                    )}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 whitespace-nowrap">
                    {relativeTime(item.createdAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => void loadMore()}
            disabled={loading}
            className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
          >
            {loading ? "Chargement…" : "Charger plus"}
          </button>
        </div>
      )}
    </Section>
  );
}
