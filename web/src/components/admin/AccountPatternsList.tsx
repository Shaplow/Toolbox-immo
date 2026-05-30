"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Edit,
  Copy,
  Trash2,
  Plus,
  AlertTriangle,
  Clock,
  Sparkles,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { Chip } from "@/components/ui/Chip";
import { Avatar, AvatarGroup } from "@/components/ui/Avatar";
import { toast } from "@/components/ui/Toast";
import { AccountPatternForm, type AccountPatternRow } from "./AccountPatternForm";
import { CloneDialog } from "./CloneDialog";
import { detectOrphanedPatternConfig } from "@/lib/publications/patternValidation";

// ─── Labels FR ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const SOURCE_LABELS: Record<string, string> = {
  auto_template: "Auto template",
  manual_rushes: "Rushes externes",
  external_upload: "Upload externe",
};

const COVER_MODE_LABELS: Record<string, string> = {
  none: "Pas de cover",
  manualSelect: "Sélection libre",
  autoPack: "Pack auto",
  monteurUpload: "Upload monteur",
  auto: "Pack auto",
};

const NEEDS_DESCRIPTION_LABELS: Record<string, string> = {
  preFilled: "Pré-remplie",
  autoGenerate: "Auto-générée",
  manualWrite: "Manuelle",
  none: "Aucune",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Pattern = AccountPatternRow & {
  template: { id: string; name: string } | null;
  defaultAssigneeMonteur: { id: string; name: string | null } | null;
  defaultAssigneeCm: { id: string; name: string | null } | null;
  _count: { publicationSlots: number };
};

type LastRender = { pngUrl: string | null; videoUrl: string | null; createdAt: string };

type Props = {
  account: { id: string; handle: string };
  patterns: Pattern[];
  /** Dernier render DONE par templateId (compte courant). Null si aucun. */
  lastRendersByTemplateId?: Record<string, LastRender | null>;
};

// ─── PatternCard ──────────────────────────────────────────────────────────────

function PatternCard({
  pattern,
  accountId,
  lastRender,
  onEdit,
  onDeleted,
}: {
  pattern: Pattern;
  accountId: string;
  lastRender: LastRender | null;
  onEdit: (pattern: Pattern) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const hasSlots = pattern._count.publicationSlots > 0;

  const orphanedConfig = detectOrphanedPatternConfig(
    {
      source: pattern.source,
      templateId: pattern.templateId,
      coverMode: pattern.coverMode,
      coverConfig: pattern.coverConfig ?? null,
      needsCaptions: pattern.needsCaptions,
      needsDescription: pattern.needsDescription,
      needsClientValidation: pattern.needsClientValidation,
      allowsClientRevision: pattern.allowsClientRevision,
      captionPresetId: pattern.captionPresetId ?? null,
      descriptionPromptId: pattern.descriptionPromptId ?? null,
    },
    null,
  );

  const days = Array.isArray(pattern.dayOfWeek)
    ? pattern.dayOfWeek
    : [pattern.dayOfWeek as unknown as number];
  const scheduleLabel =
    days.length === 0
      ? "Pattern manuel · sans planning auto"
      : `${days.map((d) => DAY_LABELS[d] ?? `J${d}`).join(" · ")} à ${pattern.publishTime}`;

  // Flags actifs uniquement — chips compacts en bas de card.
  const activeFlags = [
    pattern.needsRushes && { label: "Rushes", variant: "peach" as const },
    pattern.needsCaptions && { label: "Captions", variant: "sky" as const },
    pattern.needsBrief && { label: "Brief", variant: "sage" as const },
    pattern.needsClientValidation && {
      label: pattern.allowsClientRevision ? "Validation client (ping-pong)" : "Validation client",
      variant: "rose" as const,
    },
    pattern.needsAdminValidation && { label: "Validation admin", variant: "rose" as const },
  ].filter(Boolean) as Array<{ label: string; variant: "peach" | "sky" | "sage" | "rose" }>;

  const avatars: Array<{ id: string; name: string }> = [];
  if (pattern.defaultAssigneeMonteur) {
    avatars.push({
      id: `m-${pattern.defaultAssigneeMonteur.id}`,
      name: pattern.defaultAssigneeMonteur.name ?? "Monteur",
    });
  }
  if (pattern.defaultAssigneeCm) {
    avatars.push({
      id: `c-${pattern.defaultAssigneeCm.id}`,
      name: pattern.defaultAssigneeCm.name ?? "CM",
    });
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/patterns/${pattern.id}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        toast.success("Pattern supprimé");
        onDeleted();
        return;
      }
      const data = (await res.json()) as { error?: string };
      toast.error(data.error ?? "Erreur lors de la suppression");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      id={`pattern-${pattern.id}`}
      className={[
        "group relative grid grid-cols-[96px_1fr] gap-4 p-4 sm:p-5 rounded-2xl transition-all",
        "bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[14px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.08),0_16px_36px_-12px_rgba(15,23,42,0.18)]",
        !pattern.isActive ? "opacity-65" : "",
      ].filter(Boolean).join(" ")}
    >
      {/* Col gauche — thumbnail dernière génération de ce compte pour ce template (9:16).
          Si pas de render encore, placeholder glass discret. */}
      <PatternCover lastRender={lastRender} />

      {/* Col droite — contenu (flex-col pour ne pas dépendre de la hauteur de la cover) */}
      <div className="flex flex-col gap-4 min-w-0">
      {/* Header — label + status pills + count slots */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-gray-950 leading-tight truncate">
              {pattern.label}
            </h3>
            {!pattern.isActive && (
              <Chip variant="default" size="sm">
                Inactif
              </Chip>
            )}
            {orphanedConfig && (
              <Chip variant="peach" size="sm" icon={AlertTriangle}>
                Config invalide
              </Chip>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500 font-mono tabular-nums inline-flex items-center gap-1.5">
            <Clock size={11} className="text-gray-400" />
            {scheduleLabel}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-white/55 backdrop-blur-[6px] rounded-full px-2 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] shrink-0 tabular-nums"
          title={`${pattern._count.publicationSlots} slot${pattern._count.publicationSlots !== 1 ? "s" : ""} associé${pattern._count.publicationSlots !== 1 ? "s" : ""}`}
        >
          {pattern._count.publicationSlots} slot
          {pattern._count.publicationSlots !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Meta grid — source / template / cover / description */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[11.5px]">
        <Meta label="Source" value={SOURCE_LABELS[pattern.source] ?? pattern.source} />
        <Meta label="Template" value={pattern.template?.name ?? "—"} />
        <Meta label="Cover" value={COVER_MODE_LABELS[pattern.coverMode] ?? pattern.coverMode} />
        <Meta
          label="Description"
          value={NEEDS_DESCRIPTION_LABELS[pattern.needsDescription] ?? pattern.needsDescription}
        />
      </div>

      {/* Flags actifs en chips */}
      {activeFlags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeFlags.map((flag) => (
            <Chip key={flag.label} variant={flag.variant} size="sm">
              {flag.label}
            </Chip>
          ))}
        </div>
      )}

      {/* Footer — assignées + actions */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/40 mt-auto">
        <div className="flex items-center gap-2 min-w-0">
          {avatars.length > 0 ? (
            <>
              <AvatarGroup avatars={avatars} max={3} size="sm" />
              <span className="text-[10.5px] text-gray-500 truncate">
                {pattern.defaultAssigneeMonteur?.name}
                {pattern.defaultAssigneeMonteur && pattern.defaultAssigneeCm && " · "}
                {pattern.defaultAssigneeCm?.name}
              </span>
            </>
          ) : (
            <span className="text-[10.5px] uppercase tracking-widest font-medium text-gray-400 italic">
              Aucune assignation
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" icon={Edit} onClick={() => onEdit(pattern)}>
            Éditer
          </Button>
          {hasSlots ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled
              title={`${pattern._count.publicationSlots} slot(s) associé(s) — suppression impossible`}
              className="text-gray-300 cursor-not-allowed"
            >
              <span className="sr-only">Supprimer</span>
            </Button>
          ) : (
            <DeleteButton
              itemLabel={`le pattern "${pattern.label}"`}
              description="Cette action est irréversible. Le pattern sera définitivement supprimé."
              onConfirm={handleDelete}
              loading={deleting}
            />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function PatternCover({ lastRender }: { lastRender: LastRender | null }) {
  // Thumbnail 9:16 (largeur 96px depuis grid-cols → hauteur ~170px).
  // Priorité : pngUrl (preview rapide) > videoUrl (poster auto via attribut).
  // Placeholder glass discret si aucun render encore généré pour ce pattern.
  const hasMedia = !!(lastRender?.pngUrl || lastRender?.videoUrl);

  return (
    <div className="shrink-0">
      <div className="aspect-[9/16] rounded-xl overflow-hidden bg-gradient-to-br from-white/60 to-white/35 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] flex items-center justify-center relative">
        {hasMedia ? (
          lastRender?.pngUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lastRender.pngUrl}
              alt="Dernière génération"
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : lastRender?.videoUrl ? (
            <video
              src={lastRender.videoUrl}
              className="w-full h-full object-cover"
              preload="metadata"
              muted
              playsInline
            />
          ) : null
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-gray-300">
            <ImageIcon size={18} className="opacity-70" />
            <span className="text-[9px] uppercase tracking-widest text-center leading-tight px-1">
              Aucun rendu
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest font-medium text-gray-400 leading-tight">
        {label}
      </p>
      <p className="text-[12px] text-gray-700 truncate mt-0.5">{value}</p>
    </div>
  );
}

// Stale référence supprimée — voir CloneDialog.tsx
void Avatar;

// ─── AccountPatternsList ──────────────────────────────────────────────────────

export function AccountPatternsList({ account, patterns, lastRendersByTemplateId = {} }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link `?pattern=xxx` (depuis le badge pattern sur SlotCard).
  const targetPatternId = searchParams?.get("pattern") ?? null;
  useEffect(() => {
    if (!targetPatternId) return;
    const el = document.getElementById(`pattern-${targetPatternId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-sky-400/50", "ring-offset-2");
      const timer = setTimeout(() => {
        el.classList.remove("ring-2", "ring-sky-400/50", "ring-offset-2");
      }, 2400);
      return () => clearTimeout(timer);
    }
  }, [targetPatternId]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<Pattern | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  // Search + showInactive temporairement retirés (cf. polish 2026-05-30).
  // À réintégrer dans une toolbar dédiée si le besoin revient.

  function openCreate() {
    setEditingPattern(null);
    setFormOpen(true);
  }

  function openEdit(pattern: Pattern) {
    setEditingPattern(pattern);
    setFormOpen(true);
  }

  function openClone() {
    setCloneOpen(true);
  }

  function handleSaved() {
    router.refresh();
  }

  function handleDeleted() {
    router.refresh();
  }

  function handleCloned() {
    router.refresh();
  }

  return (
    <section>
      {/* Section header */}
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
            Workspace
          </p>
          <p className="text-[18px] font-semibold tracking-tight text-gray-950 mt-1">
            Patterns de publication
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" icon={Copy} onClick={openClone}>
            Importer
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
            Nouveau pattern
          </Button>
        </div>
      </div>

      {/* Contenu */}
      {patterns.length === 0 ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <EmptyState
            icon={Sparkles}
            title="Aucun pattern de publication"
            description="Crée un pattern pour automatiser la création de slots dans le calendrier."
            cta={{
              label: "Ajouter un pattern",
              onClick: openCreate,
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {patterns.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              accountId={account.id}
              lastRender={
                pattern.template?.id ? lastRendersByTemplateId[pattern.template.id] ?? null : null
              }
              onEdit={openEdit}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {/* Form modal (create / edit) */}
      <AccountPatternForm
        accountId={account.id}
        initialValues={editingPattern}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      {/* Clone dialog */}
      <CloneDialog
        open={cloneOpen}
        accountId={account.id}
        onClose={() => setCloneOpen(false)}
        onCloned={handleCloned}
      />
    </section>
  );
}
