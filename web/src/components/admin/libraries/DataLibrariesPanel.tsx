"use client";

/**
 * DataLibrariesPanel — liste des bibliothèques de données (refonte MID Glass).
 *
 * Cards glass franches avec édition inline (nom/description) + Modal molecule
 * pour création. Toolbar glass avec search.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Trash2, Database, ChevronRight, Search, Pencil, Check } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Chip } from "@/components/ui/Chip";
import { DataLibrarySettingsDrawer } from "./DataLibrarySettingsDrawer";

interface DataLibrary {
  id: string;
  name: string;
  templateType: string;
  description: string | null;
  /** Mode de rotation (Phase 1.x — mirror MediaLibrary). */
  rotationMode: "auto" | "override" | "none";
  /** Portée de la rotation (Phase 1.x — mirror MediaLibrary). */
  rotationScope: "shared" | "per_account";
  /** Consommation max par fiche. null = infini, 1 = strict, N>1 = soft cap V2. */
  maxUsageCount: number | null;
  /** JSON FieldDef[] — schéma des champs d'une fiche (Phase 1.x). */
  fieldsSchema: string;
  /** Token public de remplissage (Phase 1.x Vague 3). Null = pas de lien actif. */
  publicFillToken: string | null;
  createdAt: string;
  _count: { campaigns: number };
  /** Campagne active (1 max par lib enforced backend). Null si aucune campagne active. */
  activeCampaign: { id: string; name: string; entryCount: number } | null;
}

export function DataLibrariesPanel() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [libraries, setLibraries] = useState<DataLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", templateType: "", description: "" });
  const [creatingSaving, setCreatingSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Phase 1.x — édition via drawer settings (rotation + identité), plus de modal nom/desc seul.
  const [settingsTargetId, setSettingsTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/libraries/data");
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = (await res.json()) as DataLibrary[];
      setLibraries(data);
    } catch (err) {
      console.error("[DataLibrariesPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = search.trim()
    ? libraries.filter(
        (l) =>
          l.name.toLowerCase().includes(search.toLowerCase()) ||
          l.templateType.toLowerCase().includes(search.toLowerCase()),
      )
    : libraries;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreatingSaving(true);
    try {
      const res = await fetch("/api/admin/libraries/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          templateType: form.templateType,
          description: form.description,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setCreateError(d.error ?? "Erreur");
        return;
      }
      setCreating(false);
      setForm({ name: "", templateType: "", description: "" });
      toast.success("Bibliothèque créée");
      void load();
    } catch {
      setCreateError("Erreur réseau");
    } finally {
      setCreatingSaving(false);
    }
  }

  function startEdit(lib: DataLibrary) {
    setSettingsTargetId(lib.id);
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Supprimer la bibliothèque « ${name} » ?`,
      description: "Toutes les données associées seront également supprimées. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/data/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  return (
    <div className="space-y-5">
      {/* Toolbar glass */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-[300px]">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Rechercher (nom, type)"
              icon={Search}
            />
          </div>
          <span className="text-[10.5px] text-gray-500 tabular-nums">
            {filtered.length}/{libraries.length} bibliothèques
          </span>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Nouvelle bibliothèque
        </Button>
      </div>

      {/* Error */}
      {loadError && (
        <div className="rounded-xl bg-rose-50/70 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.22)]">
          <p className="text-[12.5px] font-semibold text-rose-900">
            Impossible de charger les bibliothèques
          </p>
          <p className="text-[11px] font-mono text-rose-800 mt-1">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] text-rose-700 underline mt-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] py-16 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] flex items-center justify-center text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : libraries.length === 0 ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <EmptyState
            icon={Database}
            title="Aucune bibliothèque de données"
            description="Créez-en une pour importer vos données RPI, RTIPS…"
            cta={{ label: "Nouvelle bibliothèque", onClick: () => setCreating(true) }}
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-gray-500 italic text-center py-8">
          Aucune bibliothèque correspondant à « {search} ».
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((lib) => (
            <DataLibraryCard
              key={lib.id}
              lib={lib}
              onStartEdit={() => startEdit(lib)}
              onDelete={() => void handleDelete(lib.id, lib.name)}
            />
          ))}
        </div>
      )}

      {/* Modal création */}
      <Modal open={creating} onClose={() => !creatingSaving && setCreating(false)} size="md">
        <Modal.Header onClose={() => !creatingSaving && setCreating(false)}>
          Nouvelle bibliothèque de données
        </Modal.Header>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="contents"
        >
          <Modal.Body>
            <div className="space-y-3">
              <FormField label="Nom" required>
                <Input
                  required
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Ex: Données RPI"
                />
              </FormField>
              <FormField
                label="Type de template"
                required
                help="Identifiant métier (mis en majuscules automatiquement)"
              >
                <Input
                  required
                  value={form.templateType}
                  onChange={(v) => setForm((f) => ({ ...f, templateType: v }))}
                  placeholder="Ex: RPI, RTIPS, RPOD"
                />
              </FormField>
              <FormField label="Description (optionnel)">
                <Input
                  value={form.description}
                  onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                />
              </FormField>
              {createError && (
                <p className="text-[11px] text-rose-700">{createError}</p>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={creatingSaving}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" icon={Plus} loading={creatingSaving}>
              Créer
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {/* Settings drawer (déclenché par Pencil sur card) — Phase 1.x : couvre
          identité + rotation (mode + scope + maxUsage). */}
      <DataLibrarySettingsDrawer
        open={settingsTargetId !== null}
        onClose={() => setSettingsTargetId(null)}
        library={
          settingsTargetId
            ? (() => {
                const lib = libraries.find((l) => l.id === settingsTargetId);
                return lib
                  ? {
                      id: lib.id,
                      name: lib.name,
                      description: lib.description,
                      rotationMode: lib.rotationMode,
                      rotationScope: lib.rotationScope,
                      maxUsageCount: lib.maxUsageCount,
                      fieldsSchema: lib.fieldsSchema,
                      publicFillToken: lib.publicFillToken,
                    }
                  : null;
              })()
            : null
        }
        onUpdated={() => void load()}
      />

      {confirmDialog}
    </div>
  );
}

// ─── DataLibraryCard ────────────────────────────────────────────────────────

function DataLibraryCard({
  lib,
  onStartEdit,
  onDelete,
}: {
  lib: DataLibrary;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Link
      href={`/admin/libraries/data/${lib.id}`}
      className="group relative flex flex-col gap-2.5 p-3.5 rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[14px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),0_4px_12px_-4px_rgba(15,23,42,0.12),0_16px_36px_-12px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 transition-all"
    >
      {/* Header — icône type + actions hover */}
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sage-100/70 text-sage-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.04)]">
          <Database size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-gray-950 leading-tight truncate" title={lib.name}>
            {lib.name}
          </p>
          <Chip variant="sage" size="sm" className="mt-1">
            {lib.templateType}
          </Chip>
        </div>
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStartEdit(); }}
            className="p-1 text-gray-300 hover:text-gray-700 transition-colors"
            title="Modifier"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="p-1 text-gray-300 hover:text-rose-600 transition-colors"
            title="Supprimer"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Compteur fiches — info clé : combien de fiches tournent dans cette lib.
          Phase 1.x : le concept campagne est invisible côté UI, on ne montre
          plus que le compteur de fiches actives. */}
      <div className="rounded-xl bg-gradient-to-b from-sage-50/85 to-sage-50/45 backdrop-blur-[8px] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.22)]">
        <p className="text-[9px] uppercase tracking-widest font-semibold text-sage-700 inline-flex items-center gap-1">
          <Check size={9} /> Active
        </p>
        <p className="text-[18px] font-semibold text-sage-900 tabular-nums mt-0.5 leading-tight">
          {lib.activeCampaign?.entryCount ?? 0}
        </p>
        <p className="text-[10.5px] text-sage-700/80 mt-0">
          fiche{(lib.activeCampaign?.entryCount ?? 0) !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex items-center justify-end mt-auto pt-1">
        <ChevronRight size={12} className="text-gray-300 group-hover:text-gray-700 transition-colors" />
      </div>
    </Link>
  );
}
