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
import { STATUS_LABELS } from "@/lib/slots/statusLabels";
import type { SlotStatus } from "@/types/calendar";

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
    default:
      return type;
  }
}

type ActivityIconProps = { type: string };

function ActivityIcon({ type }: ActivityIconProps) {
  const base = "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium";
  switch (type) {
    case "STATUS_CHANGED":
      return <span className={`${base} bg-sky-100 text-sky-700`} title="Statut">S</span>;
    case "ASSIGNEE_CHANGED":
      return <span className={`${base} bg-indigo-100 text-indigo-700`} title="Assignation">A</span>;
    case "RENDER_COMPLETED":
      return <span className={`${base} bg-orange-100 text-orange-700`} title="Rendu">R</span>;
    case "COVER_COMPLETED":
      return <span className={`${base} bg-pink-100 text-pink-700`} title="Cover">C</span>;
    case "CAPTIONS_COMPLETED":
      return <span className={`${base} bg-purple-100 text-purple-700`} title="Sous-titres">ST</span>;
    case "DESCRIPTION_COMPLETED":
      return <span className={`${base} bg-teal-100 text-teal-700`} title="Description">D</span>;
    case "PUBLISHED":
      return <span className={`${base} bg-green-100 text-green-700`} title="Publié">P</span>;
    case "COMMENT_ADDED":
      return <span className={`${base} bg-gray-100 text-gray-600`} title="Commentaire">💬</span>;
    default:
      return <span className={`${base} bg-gray-100 text-gray-500`} title={type}>•</span>;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityTimeline({
  slotId,
  initialActivities,
  initialHasMore,
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
    <section
      id="activity"
      className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Historique d&apos;activité</h2>

      {activities.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Aucune activité enregistrée.</p>
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
    </section>
  );
}
