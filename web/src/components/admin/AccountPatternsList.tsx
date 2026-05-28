"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutList, Edit, Copy, Trash2, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";
import { AccountPatternForm, type AccountPatternRow } from "./AccountPatternForm";
import { detectOrphanedPatternConfig } from "@/lib/publications/patternValidation";

// ─── Labels FR ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const SOURCE_LABELS: Record<string, string> = {
  auto_template: "Auto template",
  manual_rushes: "Rushes externes",
  external_upload: "Upload externe",
};

const COVER_MODE_LABELS: Record<string, string> = {
  none: "Pas de cover",
  manualSelect: "Sélection libre (CM)",
  autoPack: "Pack auto → sélection (CM)",
  monteurUpload: "Upload par le monteur",
  // Compat back : si un pattern n'a pas encore été migré (devrait pas arriver
  // après la migration data Phase 2.5, mais ceinture+bretelles).
  auto: "Pack auto → sélection (CM)",
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

type Props = {
  account: { id: string; handle: string };
  patterns: Pattern[];
};

// ─── PatternCard ──────────────────────────────────────────────────────────────

function PatternCard({
  pattern,
  accountId,
  onEdit,
  onDeleted,
}: {
  pattern: Pattern;
  accountId: string;
  onEdit: (pattern: Pattern) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const hasSlots = pattern._count.publicationSlots > 0;

  // Détection config orpheline (preset cover supprimé, preset/prompt manquant…)
  // template=null car on n'a pas la liste des coverPresetNames côté liste :
  // on signale uniquement les erreurs détectables sans template (C1, C3, C4, C5, C10).
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

  const flags: { label: string; value: boolean | string }[] = [
    { label: "Captions", value: pattern.needsCaptions },
    { label: "Rushes", value: pattern.needsRushes },
    { label: "Brief", value: pattern.needsBrief },
    { label: "Validation client", value: pattern.needsClientValidation },
  ];

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
      const data = await res.json() as { error?: string };
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
      className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 transition-all"
    >
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
            {orphanedConfig && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200 shrink-0"
                title={`${orphanedConfig.count} conflit${orphanedConfig.count > 1 ? "s" : ""} de configuration — éditer pour corriger`}
              >
                <AlertTriangle size={10} />
                Config invalide
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {(() => {
              const days = Array.isArray(pattern.dayOfWeek) ? pattern.dayOfWeek : [pattern.dayOfWeek as unknown as number];
              if (days.length === 0) return "Pattern manuel · pas de planning auto";
              const labels = days.map((d) => DAY_LABELS[d] ?? `J${d}`).join(", ");
              return `${labels} · ${pattern.publishTime}`;
            })()}
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
        <Button variant="secondary" size="sm" icon={Edit} onClick={() => onEdit(pattern)}>
          Éditer
        </Button>
        <div className="ml-auto" title={hasSlots ? `Ce pattern a ${pattern._count.publicationSlots} slot(s) associé(s). Suppression impossible.` : undefined}>
          {hasSlots ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled
              className="text-gray-300 cursor-not-allowed"
            >
              Supprimer
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

// ─── CloneDialog ──────────────────────────────────────────────────────────────

type AccountOption = { id: string; handle: string; name: string; clientName: string | null };

function CloneDialog({
  open,
  accountId,
  onClose,
  onCloned,
}: {
  open: boolean;
  accountId: string;
  onClose: () => void;
  onCloned: () => void;
}) {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  /** Filtre texte côté client — Phase 1.9 B3 */
  const [filterQuery, setFilterQuery] = useState("");

  // Load accounts list when the dialog opens
  useEffect(() => {
    if (!open) return;
    setLoadingAccounts(true);
    fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data: unknown) => {
        const raw = Array.isArray(data) ? data : [];
        const options: AccountOption[] = (raw as Array<{
          id: string;
          handle: string;
          name: string;
          client?: { name: string } | null;
        }>)
          .filter((a) => a.id !== accountId)
          .map((a) => ({
            id: a.id,
            handle: a.handle,
            name: a.name,
            clientName: a.client?.name ?? null,
          }));
        setAccounts(options);
      })
      .catch(() => {
        toast.error("Impossible de charger la liste des comptes");
      })
      .finally(() => setLoadingAccounts(false));
  }, [open, accountId]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  async function handleClone() {
    if (!sourceAccountId) {
      toast.error("Sélectionnez un compte source");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/patterns/clone-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAccountId }),
      });
      const data = await res.json() as { cloned?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erreur lors du clonage");
        return;
      }
      toast.success(`${data.cloned ?? 0} pattern(s) cloné(s)`);
      setSourceAccountId("");
      onCloned();
      onClose();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <h2 id="clone-dialog-title" className="text-base font-semibold text-gray-900 mb-1">
              Cloner des patterns depuis un autre compte
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Tous les patterns du compte source seront copiés vers ce compte.
            </p>
            <FormField label="Compte source" required>
              {loadingAccounts ? (
                <p className="text-sm text-gray-400">Chargement des comptes…</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-gray-400">Aucun autre compte disponible.</p>
              ) : (
                <div className="space-y-2">
                  {/* Filtre texte — Phase 1.9 B3 */}
                  <Input
                    value={filterQuery}
                    onChange={setFilterQuery}
                    placeholder="Filtrer par @handle ou nom de client…"
                  />
                  <select
                    value={sourceAccountId}
                    onChange={(e) => setSourceAccountId(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                  >
                    <option value="">— Sélectionner un compte —</option>
                    {accounts
                      .filter((a) => {
                        const q = filterQuery.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          a.handle.toLowerCase().includes(q) ||
                          (a.clientName ?? "").toLowerCase().includes(q) ||
                          a.name.toLowerCase().includes(q)
                        );
                      })
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          @{a.handle}{a.clientName ? ` (${a.clientName})` : ""}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </FormField>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100">
            <Button variant="ghost" size="md" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={loading}
              onClick={() => void handleClone()}
            >
              Cloner
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── AccountPatternsList ──────────────────────────────────────────────────────

export function AccountPatternsList({ account, patterns }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep-link `?pattern=xxx` (depuis le badge pattern sur SlotCard). Scroll +
  // highlight la card cible au mount pour ne pas obliger l'admin à scanner.
  const targetPatternId = searchParams?.get("pattern") ?? null;
  useEffect(() => {
    if (!targetPatternId) return;
    const el = document.getElementById(`pattern-${targetPatternId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-violet-400");
      const timer = setTimeout(() => {
        el.classList.remove("ring-2", "ring-violet-400");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [targetPatternId]);

  // Edit / Create modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<Pattern | null>(null);

  // Clone dialog
  const [cloneOpen, setCloneOpen] = useState(false);

  function openCreate() {
    setEditingPattern(null);
    setFormOpen(true);
  }

  function openEdit(pattern: Pattern) {
    setEditingPattern(pattern);
    setFormOpen(true);
  }

  function openClone() {
    // For simplicity (as per spec), "Clone" opens a global clone-from dialog
    // (all patterns from source account). A per-pattern clone UI is Wave+.
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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={Copy} onClick={openClone}>
            Importer depuis un autre compte
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={openCreate}>
            Ajouter pattern
          </Button>
        </div>
      </div>

      {/* Contenu */}
      {patterns.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          title="Aucun pattern de publication pour ce compte"
          description="Crée un pattern pour automatiser la création de slots dans le calendrier."
          cta={{
            label: "Ajouter un pattern",
            onClick: openCreate,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {patterns.map((pattern) => (
            <PatternCard
              key={pattern.id}
              pattern={pattern}
              accountId={account.id}
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
    </div>
  );
}
