/**
 * /admin/jobs — page admin de monitoring + relance des jobs bloqués.
 *
 * Ticket E8 du plan F5 (fiabilité). Server component qui scanne les
 * 6 modèles de jobs/state machines actives (Render, CaptionJob,
 * TranscriptionJob, DescriptionJob, CoverFramePack, MediaAutocutJob)
 * et affiche ceux dans des statuts de traitement (QUEUED, PROCESSING,
 * PENDING) avec leur âge.
 *
 * L'admin peut :
 * - Filtrer par âge minimum (>30min, >2h, >24h).
 * - Marquer un job FAILED manuellement (libère le slot s'il blockait).
 *
 * Pas de cron automatique pour l'instant — la page est consultée
 * manuellement par l'admin quand un slot semble bloqué.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Clock, RotateCw, X } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { JobsActionButtons } from "./_components/JobsActionButtons";
import { SweepButton } from "./_components/SweepButton";
import { BackfillCaptionSlotIdsButton } from "./_components/BackfillCaptionSlotIdsButton";

interface JobRow {
  type: "render" | "caption" | "transcription" | "description" | "cover-pack" | "autocut";
  id: string;
  status: string;
  userId: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
  label: string;
  /** Lien vers l'entité source (slot, listing, asset) pour permettre à
   *  l'admin de creuser le contexte sans copier l'ID. */
  href?: string;
}

const TYPE_LABELS: Record<JobRow["type"], string> = {
  render: "Render",
  caption: "Captions",
  transcription: "Transcription",
  description: "Description",
  "cover-pack": "Cover pack",
  autocut: "Autocut",
};

// V4 sweep : arc-en-ciel hard-codé (indigo/pink/orange/emerald/blue/purple)
// → palette Coastal Studio (peach/sage/sky/rose) + neutre pour les domaines
// pipeline éditorial. Cohérent avec /calendar et /listings.
const TYPE_COLORS: Record<JobRow["type"], string> = {
  render:        "bg-peach-50 text-peach-800 border-peach-200",
  caption:       "bg-sky-50 text-sky-800 border-sky-200",
  transcription: "bg-sage-50 text-sage-800 border-sage-200",
  description:   "bg-rose-50 text-rose-800 border-rose-200",
  "cover-pack":  "bg-peach-50 text-peach-800 border-peach-200",
  autocut:       "bg-sky-50 text-sky-800 border-sky-200",
};

function ageMs(date: Date): number {
  return Date.now() - date.getTime();
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.floor(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}j ${hours % 24}h`;
}

function ageBadgeClass(ms: number): string {
  // V4 sweep : red/amber → rose/peach (palette Coastal Studio).
  if (ms >= 2 * 60 * 60 * 1000) return "bg-rose-100 text-rose-800 border-rose-300";
  if (ms >= 30 * 60 * 1000) return "bg-peach-100 text-peach-800 border-peach-300";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

interface PageProps {
  searchParams: Promise<{ type?: string; minAge?: string }>;
}

export default async function AdminJobsPage({ searchParams }: PageProps) {
  const ctx = await getUserContext();
  if (!ctx?.actualUser || ctx.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const params = await searchParams;
  const typeFilter = params.type ?? "";
  const minAgeMinutes = params.minAge ? parseInt(params.minAge, 10) : 0;

  // ── Scan parallèle des 6 modèles de jobs actifs ──────────────────────
  const [renders, captions, transcriptions, descriptions, coverPacks, autocuts] = await Promise.all([
    prisma.render.findMany({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      select: { id: true, status: true, listingId: true, publicationSlotId: true, createdAt: true, pipeline: true, stage: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.captionJob.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: { id: true, status: true, userId: true, slotId: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.transcriptionJob.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: {
        id: true, status: true, userId: true, createdAt: true, updatedAt: true,
        render: { select: { publicationSlotId: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.descriptionJob.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: { id: true, status: true, userId: true, slotId: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.coverFramePack.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: {
        id: true, status: true, userId: true, renderId: true, publicationVersionId: true,
        createdAt: true, updatedAt: true,
        render: { select: { publicationSlotId: true } },
        publicationVersion: { select: { slotId: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.mediaAutocutJob.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: { id: true, status: true, assetId: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  // ── Normalisation en JobRow uniforme ─────────────────────────────────
  const allRows: JobRow[] = [
    ...renders.map((r): JobRow => ({
      type: "render",
      id: r.id,
      status: r.status,
      userId: null,
      createdAt: r.createdAt,
      label: `${r.publicationSlotId ? "Slot" : "Listing"} ${(r.publicationSlotId ?? r.listingId).slice(0, 8)}… (${r.pipeline ?? "?"} · ${r.stage ?? "?"})`,
      href: r.publicationSlotId ? `/publications/${r.publicationSlotId}` : `/listings`,
    })),
    ...captions.map((c): JobRow => ({
      type: "caption",
      id: c.id,
      status: c.status,
      userId: c.userId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      label: c.slotId ? `Slot ${c.slotId.slice(0, 8)}…` : `Job ${c.id.slice(0, 8)}…`,
      href: c.slotId ? `/publications/${c.slotId}` : undefined,
    })),
    ...transcriptions.map((t): JobRow => ({
      type: "transcription",
      id: t.id,
      status: t.status,
      userId: t.userId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      label: t.render?.publicationSlotId
        ? `Slot ${t.render.publicationSlotId.slice(0, 8)}…`
        : `Job ${t.id.slice(0, 8)}…`,
      href: t.render?.publicationSlotId ? `/publications/${t.render.publicationSlotId}` : undefined,
    })),
    ...descriptions.map((d): JobRow => ({
      type: "description",
      id: d.id,
      status: d.status,
      userId: d.userId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      label: d.slotId ? `Slot ${d.slotId.slice(0, 8)}…` : `Job ${d.id.slice(0, 8)}…`,
      href: d.slotId ? `/publications/${d.slotId}` : undefined,
    })),
    ...coverPacks.map((p): JobRow => {
      const slotId = p.render?.publicationSlotId ?? p.publicationVersion?.slotId ?? null;
      return {
        type: "cover-pack",
        id: p.id,
        status: p.status,
        userId: p.userId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        label: slotId
          ? `Slot ${slotId.slice(0, 8)}…`
          : p.renderId
            ? `Render ${p.renderId.slice(0, 8)}…`
            : `Version ${(p.publicationVersionId ?? "?").slice(0, 8)}…`,
        href: slotId ? `/publications/${slotId}` : undefined,
      };
    }),
    ...autocuts.map((a): JobRow => ({
      type: "autocut",
      id: a.id,
      status: a.status,
      userId: null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      label: `Asset ${a.assetId.slice(0, 8)}…`,
      href: `/admin/libraries/media`,
    })),
  ];

  // ── Filtres ──────────────────────────────────────────────────────────
  const filtered = allRows
    .filter((r) => !typeFilter || r.type === typeFilter)
    .filter((r) => ageMs(r.createdAt) >= minAgeMinutes * 60 * 1000)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // ── Stats par âge ────────────────────────────────────────────────────
  const stats = {
    total: allRows.length,
    over30min: allRows.filter((r) => ageMs(r.createdAt) >= 30 * 60 * 1000).length,
    over2h: allRows.filter((r) => ageMs(r.createdAt) >= 2 * 60 * 60 * 1000).length,
    over24h: allRows.filter((r) => ageMs(r.createdAt) >= 24 * 60 * 60 * 1000).length,
  };

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-6xl mx-auto">
      <ToolPageHeader
        icon={RotateCw}
        title="Jobs actifs & bloqués"
        subtitle="Scanner les jobs RunPod en QUEUED/PROCESSING — relancer ou marquer FAILED si bloqués"
        actions={
          <div className="flex items-center gap-2">
            <BackfillCaptionSlotIdsButton />
            <SweepButton />
            <RefreshButton title="Rescanner les jobs" />
          </div>
        }
      />

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Total actifs</p>
          <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-peach-200 bg-peach-50 p-4">
          <p className="text-xs text-peach-800 mb-1 flex items-center gap-1">
            <Clock size={11} /> {">"}30 min
          </p>
          <p className="text-2xl font-semibold text-peach-800">{stats.over30min}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs text-rose-800 mb-1 flex items-center gap-1">
            <AlertTriangle size={11} /> {">"}2 h
          </p>
          <p className="text-2xl font-semibold text-rose-800">{stats.over2h}</p>
        </div>
        <div className="rounded-xl border border-rose-300 bg-rose-100 p-4">
          <p className="text-xs text-red-800 mb-1 flex items-center gap-1">
            <AlertTriangle size={11} /> {">"}24 h (zombies)
          </p>
          <p className="text-2xl font-semibold text-red-800">{stats.over24h}</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl">
        <span className="text-xs text-gray-500">Filtrer :</span>
        {(["", "render", "caption", "transcription", "description", "cover-pack", "autocut"] as const).map((t) => (
          <Link
            key={t || "all"}
            href={`/admin/jobs?${new URLSearchParams({ ...(t ? { type: t } : {}), ...(minAgeMinutes ? { minAge: String(minAgeMinutes) } : {}) }).toString()}`}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              typeFilter === t
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
            }`}
          >
            {t === "" ? "Tous" : TYPE_LABELS[t]}
          </Link>
        ))}
        <span className="text-xs text-gray-400 mx-2">·</span>
        <span className="text-xs text-gray-500">Âge ≥</span>
        {[0, 30, 120, 1440].map((m) => (
          <Link
            key={m}
            href={`/admin/jobs?${new URLSearchParams({ ...(typeFilter ? { type: typeFilter } : {}), ...(m ? { minAge: String(m) } : {}) }).toString()}`}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              minAgeMinutes === m
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
            }`}
          >
            {m === 0 ? "Tous" : m === 30 ? "30 min" : m === 120 ? "2 h" : "24 h"}
          </Link>
        ))}
        {(typeFilter || minAgeMinutes) && (
          <Link
            href="/admin/jobs"
            className="ml-auto text-xs text-gray-500 hover:text-red-500 flex items-center gap-0.5"
          >
            <X size={11} /> Reset
          </Link>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">
          <RotateCw size={32} className="text-gray-200 mx-auto mb-3" />
          {allRows.length === 0
            ? "Aucun job actif. Pipeline sain."
            : `Aucun job correspondant aux filtres (${allRows.length} jobs au total).`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Type</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">ID / Détails</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Statut</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Âge</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {filtered.map((row) => {
                const age = ageMs(row.createdAt);
                return (
                  <tr key={`${row.type}-${row.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_COLORS[row.type]}`}>
                        {TYPE_LABELS[row.type]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {row.href ? (
                        <Link
                          href={row.href}
                          className="text-gray-700 hover:text-gray-950 hover:underline"
                          title="Ouvrir la source"
                        >
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{row.status}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded border ${ageBadgeClass(age)}`}>
                        {formatAge(age)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <JobsActionButtons type={row.type} id={row.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}
