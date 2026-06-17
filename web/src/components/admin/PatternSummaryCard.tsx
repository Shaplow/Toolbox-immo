"use client";

/**
 * PatternSummaryCard — résumé compact d'une recette éditoriale (PatternTemplate).
 *
 * Utilisée dans PatternPeekDrawer. Affiche identité, source, modes
 * captions/description/cover, flags workflow, top 5 comptes liés, dernier
 * éditeur. Pas de CTA — les actions vivent dans le footer du drawer hôte.
 */

import { Sparkles, FileText, Image, Users, ShieldCheck } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import {
  SOURCE_LABELS_FR,
  COVER_MODE_LABELS_FR,
  NEEDS_DESCRIPTION_LABELS_FR,
  CAPTIONS_MODE_LABELS_FR,
} from "@/lib/i18n/entityLabels";

export interface PatternPeekData {
  id: string;
  label: string;
  source: string;
  isArchived: boolean;
  coverMode: string;
  needsCaptionsMode: string;
  needsDescription: string;
  flags: {
    needsBrief: boolean;
    needsAdminValidation: boolean;
    needsClientValidation: boolean;
    allowsClientRevision: boolean;
  };
  templateName: string | null;
  captionPresetName: string | null;
  descriptionPromptName: string | null;
  notes: string | null;
  bindingCount: number;
  linkedAccounts: Array<{
    bindingId: string;
    accountId: string;
    handle: string;
    name: string;
    publishTime: string;
    isActive: boolean;
    customLabel: string | null;
  }>;
  updatedAt: string;
  updatedBy: { name: string | null } | null;
}

const SOURCE_VARIANT: Record<string, "default" | "sky" | "peach" | "sage"> = {
  auto_template: "sky",
  manual_rushes: "peach",
  external_upload: "sage",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PatternSummaryCard({ data }: { data: PatternPeekData }) {
  const flagChips = [
    data.flags.needsBrief && { label: "Brief", variant: "sage" as const },
    data.flags.needsAdminValidation && {
      label: "Validation admin",
      variant: "rose" as const,
    },
    data.flags.needsClientValidation && {
      label: data.flags.allowsClientRevision
        ? "Validation client (ping-pong)"
        : "Validation client",
      variant: "rose" as const,
    },
  ].filter(Boolean) as Array<{
    label: string;
    variant: "sage" | "rose";
  }>;

  return (
    <div className="space-y-4">
      {/* Identité */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold tracking-tight text-foreground truncate">
              {data.label}
            </h3>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <Chip
                variant={SOURCE_VARIANT[data.source] ?? "default"}
                size="sm"
              >
                {SOURCE_LABELS_FR[data.source] ?? data.source}
              </Chip>
              {data.isArchived && (
                <Chip variant="default" size="sm">
                  Archivée
                </Chip>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              Comptes liés
            </p>
            <p className="mt-1 text-[18px] font-semibold text-foreground font-mono tabular-nums">
              {data.bindingCount}
            </p>
          </div>
        </div>
      </div>

      {/* Modes production */}
      <div className="grid grid-cols-1 gap-2">
        <MetaRow
          icon={Sparkles}
          label="Template"
          value={data.templateName ?? "—"}
        />
        <MetaRow
          icon={Image}
          label="Cover"
          value={COVER_MODE_LABELS_FR[data.coverMode] ?? data.coverMode}
        />
        <MetaRow
          icon={FileText}
          label="Sous-titres"
          value={
            data.needsCaptionsMode === "auto" && data.captionPresetName
              ? `Auto · ${data.captionPresetName}`
              : CAPTIONS_MODE_LABELS_FR[data.needsCaptionsMode] ??
                data.needsCaptionsMode
          }
        />
        <MetaRow
          icon={FileText}
          label="Description"
          value={
            data.needsDescription === "autoGenerate" && data.descriptionPromptName
              ? `Auto IA · ${data.descriptionPromptName}`
              : NEEDS_DESCRIPTION_LABELS_FR[data.needsDescription] ??
                data.needsDescription
          }
        />
      </div>

      {/* Workflow flags */}
      {flagChips.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2 inline-flex items-center gap-1">
            <ShieldCheck size={11} className="text-muted-foreground" />
            Workflow
          </p>
          <div className="flex flex-wrap gap-1.5">
            {flagChips.map((flag) => (
              <Chip key={flag.label} variant={flag.variant} size="sm">
                {flag.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* Linked accounts (top 5) */}
      {data.linkedAccounts.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2 inline-flex items-center gap-1">
            <Users size={11} className="text-muted-foreground" />
            Comptes liés
            {data.bindingCount > data.linkedAccounts.length
              ? ` · top ${data.linkedAccounts.length}`
              : ""}
          </p>
          <ul className="space-y-1.5">
            {data.linkedAccounts.map((b) => (
              <li
                key={b.bindingId}
                className={`rounded-lg bg-card border border-border px-3 py-2  ${
                  !b.isActive ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-[12px] font-medium text-foreground truncate">
                    @{b.handle}
                  </p>
                  <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
                    {b.publishTime}
                  </span>
                </div>
                {b.customLabel && (
                  <p className="text-[10.5px] text-muted-foreground truncate mt-0.5">
                    {b.customLabel}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes (preview) */}
      {data.notes && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-1">
            Notes
          </p>
          <p className="text-[11.5px] text-foreground line-clamp-3">{data.notes}</p>
        </div>
      )}

      {/* Footer méta */}
      <p className="text-[10.5px] text-muted-foreground">
        Modifiée le {formatDate(data.updatedAt)}
        {data.updatedBy?.name ? ` · ${data.updatedBy.name}` : ""}
      </p>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-[10.5px] uppercase tracking-widest font-medium text-muted-foreground inline-flex items-center gap-1 shrink-0">
        <Icon size={11} className="text-muted-foreground" />
        {label}
      </span>
      <span className="text-[12px] text-gray-800 truncate text-right">
        {value}
      </span>
    </div>
  );
}
