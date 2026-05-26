"use client";

import { LayoutList, Edit, Copy, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

// ─── Labels FR ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const SOURCE_LABELS: Record<string, string> = {
  auto_template: "Auto template",
  manual_rushes: "Rushes externes",
  external_upload: "Upload externe",
};

const COVER_MODE_LABELS: Record<string, string> = {
  auto: "Automatique",
  manualSelect: "Sélection manuelle",
  none: "Aucune",
};

const NEEDS_DESCRIPTION_LABELS: Record<string, string> = {
  preFilled: "Pré-remplie",
  autoGenerate: "Auto-générée",
  manualWrite: "Manuelle",
  none: "Aucune",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Pattern = {
  id: string;
  label: string;
  source: string;
  coverMode: string;
  needsCaptions: boolean;
  needsDescription: string;
  needsRushes: boolean;
  needsBrief: boolean;
  needsClientValidation: boolean;
  dayOfWeek: number;
  publishTime: string;
  isActive: boolean;
  template: { id: string; name: string } | null;
  library: { id: string; name: string } | null;
  defaultAssigneeMonteur: { id: string; name: string | null } | null;
  defaultAssigneeCm: { id: string; name: string | null } | null;
  _count: { publicationSlots: number };
};

type Props = {
  account: { id: string; handle: string };
  patterns: Pattern[];
};

// ─── PatternCard ──────────────────────────────────────────────────────────────

function PatternCard({ pattern }: { pattern: Pattern }) {
  const comingSoon = "Disponible prochainement (Wave C3)";

  const flags: { label: string; value: boolean | string }[] = [
    { label: "Captions", value: pattern.needsCaptions },
    { label: "Rushes", value: pattern.needsRushes },
    { label: "Brief", value: pattern.needsBrief },
    { label: "Validation client", value: pattern.needsClientValidation },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4">
      {/* Header de la card */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{pattern.label}</h3>
            {!pattern.isActive && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 shrink-0">
                Inactif
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {DAY_LABELS[pattern.dayOfWeek] ?? `Jour ${pattern.dayOfWeek}`} · {pattern.publishTime}
          </p>
        </div>
        <span className="text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-1 shrink-0">
          {pattern._count.publicationSlots} slot{pattern._count.publicationSlots !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Corps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <Row label="Source" value={SOURCE_LABELS[pattern.source] ?? pattern.source} />
        <Row label="Template" value={pattern.template?.name ?? "—"} />
        <Row label="Bibliothèque" value={pattern.library?.name ?? "—"} />
        <Row label="Cover" value={COVER_MODE_LABELS[pattern.coverMode] ?? pattern.coverMode} />
        <Row
          label="Description"
          value={NEEDS_DESCRIPTION_LABELS[pattern.needsDescription] ?? pattern.needsDescription}
        />
      </div>

      {/* Flags booléens */}
      <div className="flex flex-wrap gap-2">
        {flags.map(({ label, value }) => (
          <span
            key={label}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
              value
                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                : "bg-gray-50 border-gray-100 text-gray-400"
            }`}
          >
            <span className={value ? "text-indigo-500" : "text-gray-300"}>
              {value ? "✓" : "·"}
            </span>
            {label}
          </span>
        ))}
      </div>

      {/* Assignations */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span>
          <span className="font-medium text-gray-700">Monteur :</span>{" "}
          {pattern.defaultAssigneeMonteur?.name ?? <span className="italic text-gray-300">—</span>}
        </span>
        <span>
          <span className="font-medium text-gray-700">CM :</span>{" "}
          {pattern.defaultAssigneeCm?.name ?? <span className="italic text-gray-300">—</span>}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
        <Button variant="secondary" size="sm" icon={Edit} disabled title={comingSoon}>
          Éditer
        </Button>
        <Button variant="ghost" size="sm" icon={Copy} disabled title={comingSoon}>
          Cloner
        </Button>
        <Button variant="ghost" size="sm" icon={Trash2} disabled title={comingSoon} className="ml-auto text-gray-400">
          Supprimer
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="font-medium text-gray-600 shrink-0">{label} :</span>
      <span className="text-gray-700 truncate">{value}</span>
    </div>
  );
}

// ─── AccountPatternsList ──────────────────────────────────────────────────────

export function AccountPatternsList({ patterns }: Props) {
  function handleAddPattern() {
    toast.info("Édition des patterns disponible en Wave C3.");
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LayoutList size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Patterns de publication</h2>
          {patterns.length > 0 && (
            <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-semibold">
              {patterns.length}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={Plus}
          onClick={handleAddPattern}
          title="Édition disponible en Wave C3"
        >
          Ajouter pattern
        </Button>
      </div>

      {/* Contenu */}
      {patterns.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          title="Aucun pattern de publication pour ce compte"
          description="Crée un pattern pour automatiser la création de slots dans le calendrier."
          cta={{
            label: "Ajouter un pattern",
            onClick: handleAddPattern,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {patterns.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </div>
      )}
    </div>
  );
}
