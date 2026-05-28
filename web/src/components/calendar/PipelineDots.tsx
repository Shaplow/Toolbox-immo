"use client";

/**
 * PipelineDots — mini indicateur pipeline pour SlotCard du calendrier.
 *
 * Affiche jusqu'à 5 dots colorés (render, cover, captions, description, publish)
 * basés sur les infos déjà chargées par /api/calendar/slots (status du slot +
 * status du render + needs* du pattern). Pas de fetch supplémentaire.
 *
 * Les dots des étapes non applicables (selon le pattern) sont rendus en gris
 * très clair, opacité 30%. Le tooltip natif `title` donne l'état au hover.
 */

import type { PublicationSlot } from "@/types/calendar";

type DotStatus = "todo" | "processing" | "done" | "failed" | "muted";

const COLOR_CLASS: Record<DotStatus, string> = {
  todo: "bg-gray-300",
  processing: "bg-blue-400",
  done: "bg-green-500",
  failed: "bg-red-500",
  muted: "bg-gray-100 opacity-30",
};

const LABEL: Record<DotStatus, string> = {
  todo: "à faire",
  processing: "en cours",
  done: "fait",
  failed: "en erreur",
  muted: "non applicable",
};

const PUBLISHED = "PUBLISHED";
const READY_STATUSES = new Set([
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "AWAITING_CLIENT",
  "CLIENT_REVISION",
  "SCHEDULED",
  PUBLISHED,
]);

function renderStatus(slot: PublicationSlot): DotStatus {
  // Render visible seulement si pattern.source === "auto_template" — sinon muted.
  // On n'a pas pattern.source dans le slot type → on déduit via la présence d'un templateId.
  const visible = !!slot.templateId;
  if (!visible) return "muted";
  const r = slot.render;
  if (!r) return "todo";
  if (r.status === "DONE") return "done";
  if (r.status === "ERROR" || r.status === "FAILED") return "failed";
  return "processing";
}

function coverStatus(slot: PublicationSlot): DotStatus {
  const mode = slot.coverModeOverride ?? slot.pattern?.coverMode;
  if (!mode || mode === "none") return "muted";
  // On ne charge pas coverFramePack — on déduit grossièrement via le slot.status.
  if (slot.status === PUBLISHED) return "done";
  if (READY_STATUSES.has(slot.status)) return "processing";
  return "todo";
}

function captionsStatus(slot: PublicationSlot): DotStatus {
  const needs = slot.needsCaptionsOverride ?? slot.pattern?.needsCaptions;
  if (!needs) return "muted";
  if (slot.status === PUBLISHED) return "done";
  if (READY_STATUSES.has(slot.status)) return "processing";
  return "todo";
}

function descriptionStatus(slot: PublicationSlot): DotStatus {
  const needs = slot.needsDescriptionOverride ?? slot.pattern?.needsDescription;
  if (!needs || needs === "none") return "muted";
  if (slot.status === PUBLISHED) return "done";
  if (READY_STATUSES.has(slot.status)) return "processing";
  return "todo";
}

function publishStatus(slot: PublicationSlot): DotStatus {
  if (slot.status === PUBLISHED) return "done";
  if (slot.status === "BLOCKED" || slot.status === "CANCELLED" || slot.status === "ARCHIVED") {
    return "failed";
  }
  return "todo";
}

interface Props {
  slot: PublicationSlot;
}

export function PipelineDots({ slot }: Props) {
  const dots: Array<{ key: string; label: string; status: DotStatus }> = [
    { key: "render", label: "Rendu", status: renderStatus(slot) },
    { key: "cover", label: "Cover", status: coverStatus(slot) },
    { key: "captions", label: "Sous-titres", status: captionsStatus(slot) },
    { key: "description", label: "Description", status: descriptionStatus(slot) },
    { key: "publish", label: "Publication", status: publishStatus(slot) },
  ];

  return (
    <div className="flex items-center gap-1" aria-label="Pipeline">
      {dots.map((d) => (
        <span
          key={d.key}
          title={`${d.label} : ${LABEL[d.status]}`}
          className={`block w-1.5 h-1.5 rounded-full ${COLOR_CLASS[d.status]}`}
        />
      ))}
    </div>
  );
}
