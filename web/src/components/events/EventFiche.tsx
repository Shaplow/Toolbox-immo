"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Film,
  Clapperboard,
  Download,
  Trash2,
  Plus,
  MapPin,
  CalendarClock,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MediaDropzone } from "@/components/ui/MediaDropzone";
import { toast } from "@/components/ui/Toast";
import { STATUS_LABELS } from "@/types/calendar";
import {
  EVENT_STATUS_BADGE,
  EVENT_STATUS_LABELS,
  type ShootEventStatus,
} from "@/types/events";
import { AttachReelModal } from "./AttachReelModal";

const RUSH_ACCEPT = [
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const RUSH_MAX = 20 * 1024 * 1024 * 1024;

export interface EventFicheReel {
  id: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
}
export interface EventFicheRush {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  durationSec: number | null;
  uploadedAt: string;
  uploadedByName: string | null;
}
export interface EventFicheActivity {
  id: string;
  type: string;
  createdAt: string;
  actorName: string | null;
}
export interface EventFicheData {
  id: string;
  title: string;
  status: ShootEventStatus;
  accountLabel: string | null;
  propertyLabel: string | null;
  scheduledAtLabel: string;
  videasteName: string | null;
  notes: string | null;
  reels: EventFicheReel[];
  rushes: EventFicheRush[];
  activities: EventFicheActivity[];
}

export interface EventFicheProps {
  event: EventFicheData;
  recipes: { id: string; label: string }[];
  canUploadRushes: boolean;
  canAttachReel: boolean;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

const ACTIVITY_LABELS: Record<string, string> = {
  EVENT_CREATED: "Événement créé",
  EVENT_UPDATED: "Événement modifié",
  EVENT_STATUS_CHANGED: "Statut changé",
  EVENT_RUSHES_UPLOADED: "Rush ajouté",
  EVENT_RUSHES_DELETED: "Rush supprimé",
  EVENT_SHOT: "Tournage réalisé",
  EVENT_REEL_ATTACHED: "Reel ajouté",
  EVENT_CANCELLED: "Événement annulé",
  EVENT_DONE: "Événement terminé",
};

export function EventFiche({ event, recipes, canUploadRushes, canAttachReel }: EventFicheProps) {
  const router = useRouter();
  const [attachOpen, setAttachOpen] = useState(false);

  async function downloadRush(rushId: string) {
    try {
      const res = await fetch(`/api/shoot-events/${event.id}/rushes/${rushId}`);
      if (!res.ok) throw new Error();
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      window.open(downloadUrl, "_blank");
    } catch {
      toast.error("Échec du téléchargement");
    }
  }

  async function deleteRush(rushId: string) {
    try {
      const res = await fetch(`/api/shoot-events/${event.id}/rushes/${rushId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Rush supprimé");
      router.refresh();
    } catch {
      toast.error("Échec de la suppression");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors mb-3 focus-ring"
        >
          <ArrowLeft size={14} /> Événements
        </Link>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{event.title}</h1>
            <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={13} /> {event.scheduledAtLabel}
              </span>
              {event.accountLabel && <span>@{event.accountLabel}</span>}
              {event.propertyLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} /> {event.propertyLabel}
                </span>
              )}
              {event.videasteName && (
                <span className="inline-flex items-center gap-1">
                  <UserIcon size={13} /> {event.videasteName}
                </span>
              )}
            </div>
          </div>
          <span
            className={[
              "ml-auto shrink-0 text-[11px] rounded-md px-2 py-1 border",
              EVENT_STATUS_BADGE[event.status],
            ].join(" ")}
          >
            {EVENT_STATUS_LABELS[event.status]}
          </span>
        </div>
        {event.notes && (
          <p className="mt-3 text-[13px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {event.notes}
          </p>
        )}
      </div>

      {/* Rushs */}
      <section className="rounded-lg bg-card border border-border">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Clapperboard size={15} className="text-muted-foreground" />
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
            Rushs du tournage
          </h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">· {event.rushes.length}</span>
        </header>
        <div className="p-4 space-y-3">
          {canUploadRushes && (
            <MediaDropzone
              slotId={event.id}
              uploadBasePath={`/api/shoot-events/${event.id}`}
              kind="rush"
              accept={RUSH_ACCEPT}
              maxSizeBytes={RUSH_MAX}
              onUploaded={() => {
                toast.success("Rush uploadé");
                router.refresh();
              }}
              onError={(msg) => toast.error(msg)}
              label="Déposez les rushs du tournage (partagés par tous les reels)"
            />
          )}
          {event.rushes.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Aucun rush pour l&apos;instant.</p>
          ) : (
            <ul className="divide-y divide-border">
              {event.rushes.map((rush) => (
                <li key={rush.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-foreground truncate">{rush.fileName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(rush.sizeBytes)}
                      {rush.uploadedByName ? ` · ${rush.uploadedByName}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadRush(rush.id)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground focus-ring"
                    aria-label="Télécharger"
                  >
                    <Download size={15} />
                  </button>
                  {canUploadRushes && (
                    <button
                      type="button"
                      onClick={() => deleteRush(rush.id)}
                      className="p-1.5 rounded-md hover:bg-danger-50 text-muted-foreground hover:text-danger-700 focus-ring"
                      aria-label="Supprimer"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Reels */}
      <section className="rounded-lg bg-card border border-border">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Film size={15} className="text-muted-foreground" />
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Reels attachés</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">· {event.reels.length}</span>
          {canAttachReel && (
            <Button size="sm" variant="secondary" icon={Plus} className="ml-auto" onClick={() => setAttachOpen(true)}>
              Ajouter un reel
            </Button>
          )}
        </header>
        <div className="p-2">
          {event.reels.length === 0 ? (
            <EmptyState
              icon={<Film size={20} className="text-muted-foreground" />}
              title="Aucun reel"
              description="Accrochez des reels à ce tournage — pendant ou après, autant que nécessaire."
              {...(canAttachReel ? { cta: { label: "Ajouter un reel", onClick: () => setAttachOpen(true) } } : {})}
            />
          ) : (
            <ul className="divide-y divide-border">
              {event.reels.map((reel) => (
                <li key={reel.id}>
                  <Link
                    href={`/publications/${reel.id}`}
                    className="flex items-center justify-between gap-3 px-2 py-2.5 rounded-md hover:bg-muted transition-colors focus-ring"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {reel.title ?? "Reel"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {reel.scheduledAt
                          ? new Date(reel.scheduledAt).toLocaleDateString("fr-FR", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "En banque"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground rounded-md bg-muted px-1.5 py-0.5 border border-border">
                      {STATUS_LABELS[reel.status as keyof typeof STATUS_LABELS] ?? reel.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Activité */}
      {event.activities.length > 0 && (
        <section className="rounded-lg bg-card border border-border">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Activité</h2>
          </header>
          <ul className="p-4 space-y-2">
            {event.activities.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
                <span className="text-foreground">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                <span className="text-muted-foreground">
                  {a.actorName ? `· ${a.actorName}` : ""}
                </span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {new Date(a.createdAt).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canAttachReel && (
        <AttachReelModal
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          eventId={event.id}
          recipes={recipes}
        />
      )}
    </div>
  );
}
