"use client";

/**
 * PipelineDots — mini indicateur pipeline pour SlotCard du calendrier.
 *
 * Affiche jusqu'à 5 dots colorés (render, cover, captions, description, publish)
 * basés sur les **vraies données des jobs** chargés par /api/calendar/slots.
 *
 * Avant Phase 2.2, les statuts cover/captions/description étaient déduits du
 * slot.status via une heuristique READY_STATUSES, ce qui mentait dès qu'un
 * job était dans un état différent (ex: cover encore QUEUED alors que slot
 * était déjà READY_FOR_CM). Maintenant : chaque dot lit directement le status
 * du job associé.
 *
 * Les dots des étapes non applicables (selon le pattern) sont rendus en gris
 * très clair, opacité 30%. Le tooltip natif `title` donne l'état au hover.
 */

import { resolveCaptionsMode } from "@/lib/publications/captionsMode";
import type { PublicationSlot } from "@/types/calendar";

type DotStatus = "todo" | "processing" | "done" | "failed" | "muted";

const COLOR_CLASS: Record<DotStatus, string> = {
  todo: "bg-gray-300",
  processing: "bg-blue-400",
  done: "bg-green-500",
  failed: "bg-red-500",
  muted: "bg-muted opacity-30",
};

const LABEL: Record<DotStatus, string> = {
  todo: "à faire",
  processing: "en cours",
  done: "fait",
  failed: "en erreur",
  muted: "non applicable",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderStatus(slot: PublicationSlot): DotStatus {
  // Render visible uniquement pour les patterns auto_template. On ne peut
  // pas distinguer 100% sûr sans pattern.source (le type ne l'expose pas
  // toujours sur la card), donc on prend templateId comme proxy fiable :
  // un slot sans templateId n'a jamais de render auto.
  if (!slot.templateId) return "muted";
  const r = slot.render;
  if (!r) return "todo";
  switch (r.status) {
    case "DONE":
      return "done";
    case "ERROR":
    case "FAILED":
      return "failed";
    case "PENDING":
    case "PROCESSING":
    case "QUEUED":
      return "processing";
    default:
      return "todo";
  }
}

function coverStatus(slot: PublicationSlot): DotStatus {
  const mode = slot.coverModeOverride ?? slot.pattern?.coverMode;
  if (!mode || mode === "none") return "muted";

  // CoverFramePack peut être rattaché soit au render (auto_template) soit à
  // la currentVersion (manual_rushes / external_upload). On prend le premier
  // disponible — précédence à la version (plus récent dans le cycle de vie).
  const pack =
    slot.currentVersion?.coverFramePack ??
    slot.render?.coverFramePack ??
    null;
  if (!pack) return "todo";

  switch (pack.status) {
    case "SELECTED":
      return "done";
    case "READY":
      // READY sans selection : on attend l'action CM → encore "todo" UX
      return "todo";
    case "FAILED":
      return "failed";
    case "QUEUED":
    case "PROCESSING":
      return "processing";
    default:
      return "todo";
  }
}

function captionsStatus(slot: PublicationSlot): DotStatus {
  const mode = resolveCaptionsMode({
    slot: { needsCaptionsModeOverride: slot.needsCaptionsModeOverride },
    pattern: slot.pattern ? { needsCaptionsMode: slot.pattern.needsCaptionsMode } : null,
  });
  if (mode === "none") return "muted";

  const job = slot.captionJobs?.[0];
  if (!job) return "todo";

  switch (job.status) {
    case "COMPLETED":
      return "done";
    case "FAILED":
      return "failed";
    case "QUEUED":
    case "PROCESSING":
      return "processing";
    default:
      return "todo";
  }
}

function descriptionStatus(slot: PublicationSlot): DotStatus {
  const needs = slot.needsDescriptionOverride ?? slot.pattern?.needsDescription;
  if (!needs || needs === "none") return "muted";

  // Si la légende a été rédigée à la main (slot.description), c'est "done"
  // même sans DescriptionJob — la CM a écrit directement.
  if (slot.description && slot.description.trim().length > 0) return "done";

  const job = slot.descriptionJobs?.[0];
  if (!job) return "todo";

  switch (job.status) {
    case "COMPLETED":
      return job.result && job.result.trim().length > 0 ? "done" : "todo";
    case "FAILED":
      return "failed";
    case "QUEUED":
    case "PROCESSING":
      return "processing";
    default:
      return "todo";
  }
}

function publishStatus(slot: PublicationSlot): DotStatus {
  if (slot.status === "PUBLISHED") return "done";
  // ARCHIVED = sortie de cycle saine (publication ancienne archivée) — pas
  // un échec. CANCELLED = sortie annulée par décision admin — pas un bug
  // de pipeline non plus. BLOCKED reste "failed" car c'est explicitement
  // un état d'erreur qui requiert une intervention.
  if (slot.status === "BLOCKED") return "failed";
  if (slot.status === "CANCELLED" || slot.status === "ARCHIVED") return "muted";
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
    { key: "description", label: "Légende", status: descriptionStatus(slot) },
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
