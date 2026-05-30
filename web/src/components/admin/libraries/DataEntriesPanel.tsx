"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Upload, RotateCcw, Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Chip } from "@/components/ui/Chip";
import { toast } from "@/components/ui/Toast";
import { DataEntriesSpreadsheet } from "@/components/admin/libraries/dataEntries/DataEntriesSpreadsheet";

function downloadCSVFromColumns(columns: string[], campaignName: string) {
  const headers = ["set_tag", "category", ...columns];
  const csv = headers.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `modele-${campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface DataEntry {
  id: string;
  fields: string;
  setTag: string | null;
  category: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  usedInCycle: boolean;
  createdAt: string;
  accessAccountIds: string[];
}

interface DataCampaign {
  id: string;
  name: string;
  isActive: boolean;
  usagePolicy: string;
  _count: { entries: number };
}

export interface InstagramAccount {
  id: string;
  name: string;
  handle: string;
}

type FieldType = "text" | "number" | "url" | "textarea";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Marque le champ pour affichage dans la vue table compacte (Phase 1.x design). */
  primary?: boolean;
}

interface Props {
  campaignId: string;
  libraryId: string;
  /** JSON FieldDef[] depuis DataLibrary.fieldsSchema (Phase 1.x). */
  fieldsSchema?: string;
}

function parseFieldsSchema(raw: string | null | undefined): FieldDef[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((f): f is FieldDef =>
      f && typeof f.key === "string" && typeof f.label === "string" && typeof f.type === "string",
    );
  } catch {
    return [];
  }
}

import { useConfirm } from "@/components/ui/useConfirm";

export function DataEntriesPanel({ campaignId, libraryId, fieldsSchema }: Props) {
  // Phase 1.x — schéma de champs au niveau lib (source de vérité).
  const declaredSchema = useMemo(() => parseFieldsSchema(fieldsSchema), [fieldsSchema]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [campaign, setCampaign] = useState<DataCampaign | null>(null);
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resettingAccount, setResettingAccount] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 1.x design (spreadsheet) — édition inline, plus de drawer.
  // focusBottomSignal bump à chaque création vide pour que la spreadsheet
  // scroll + focus la cellule Set de la dernière row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusBottomSignal, setFocusBottomSignal] = useState(0);

  // Phase 1.x — fallback rétrocompatible : si la lib n'a pas de schéma déclaré
  // (libs legacy ou utilisateur qui n'a pas configuré les champs), on auto-déduit
  // depuis les fields des entries existantes (toutes typées "text"). Permet à la
  // spreadsheet de toujours afficher des colonnes pour les fiches importées.
  const schemaFields = useMemo<FieldDef[]>(() => {
    if (declaredSchema.length > 0) return declaredSchema;
    const keys = new Set<string>();
    for (const e of entries) {
      try {
        const parsed = JSON.parse(e.fields) as Record<string, unknown>;
        Object.keys(parsed).forEach((k) => {
          if (k !== "set_tag" && k !== "category") keys.add(k);
        });
      } catch {
        // ignore
      }
    }
    return Array.from(keys).map<FieldDef>((k) => ({ key: k, label: k, type: "text" }));
  }, [declaredSchema, entries]);

  const isAccessible = useCallback((entry: DataEntry) => {
    return entry.accessAccountIds.length === 0 || (accountFilter ? entry.accessAccountIds.includes(accountFilter) : true);
  }, [accountFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entriesUrl = accountFilter
        ? `/api/admin/libraries/data/campaigns/${campaignId}/entries?accountId=${encodeURIComponent(accountFilter)}`
        : `/api/admin/libraries/data/campaigns/${campaignId}/entries`;
      const [camRes, entriesRes] = await Promise.all([
        fetch(`/api/admin/libraries/data/${libraryId}/campaigns`),
        fetch(entriesUrl),
      ]);
      if (!camRes.ok) throw new Error(`campaigns HTTP ${camRes.status}`);
      const campaigns = await camRes.json() as DataCampaign[];
      setCampaign(campaigns.find((c) => c.id === campaignId) ?? null);
      if (entriesRes.ok) {
        const data = await entriesRes.json() as DataEntry[];
        setEntries(data);
      }
    } catch (err) {
      console.error("[DataEntriesPanel] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [campaignId, libraryId, accountFilter]);

  useEffect(() => { void load(); }, [load]);

  // Load accounts for filter selector
  useEffect(() => {
    fetch("/api/admin/accounts")
      .then((r) => r.ok ? r.json() : [])
      .then((data: unknown) => setAccounts(data as InstagramAccount[]))
      .catch(() => {/* ignore */});
  }, []);

  // Phase 1.x — colonnes dérivées du schéma lib si défini, sinon fallback
  // sur l'auto-déduction depuis la 1ère entry (rétrocompat libs legacy).
  const columns: string[] = schemaFields.length > 0
    ? schemaFields.map((f) => f.key)
    : entries.length > 0
      ? Object.keys(JSON.parse(entries[0]!.fields) as Record<string, string>).filter(
          (k) => !["set_tag", "category"].includes(k),
        )
      : [];

  /** Import effectif d'un fichier CSV — extrait pour pouvoir être appelé
   *  depuis le drop-zone page-level en plus du <input type="file">. */
  async function importCSVFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    // CSV ET xlsx passent tels quels — le serveur détecte et parse selon l'extension/MIME.
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/import`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setImportError(d.error ?? "Erreur lors de l'import");
    } else {
      const d = await res.json() as { imported: number };
      if (d.imported === 0) {
        // B8 — Distinguer "0 importé" (= format invalide, fichier vide, colonnes
        // qui ne matchent pas) du vrai succès. Avant, "0 entrées importées avec
        // succès" était silencieux et trompeur.
        setImportError(
          "Aucune ligne importée. Vérifie que ton CSV contient au moins les colonnes 'set_tag' et 'category', et que le format est valide (séparateur virgule, encodage UTF-8)."
        );
      } else {
        setImportSuccess(`${d.imported} entrée${d.imported !== 1 ? "s" : ""} importée${d.imported !== 1 ? "s" : ""} avec succès`);
        void load();
      }
    }
    setImporting(false);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await importCSVFile(file);
  }

  // ── Drop-zone page-level pour CSV ───────────────────────────────────
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  function handleDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragDepthRef.current += 1;
    setPageDragOver(true);
  }
  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
  }
  function handleDragLeave() {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setPageDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepthRef.current = 0;
    setPageDragOver(false);
    const file = Array.from(e.dataTransfer.files ?? []).find((f) => {
      const n = f.name.toLowerCase();
      return (
        n.endsWith(".csv") ||
        n.endsWith(".xlsx") ||
        n.endsWith(".xls") ||
        f.type === "text/csv" ||
        f.type === "text/plain" ||
        f.type.includes("spreadsheet") ||
        f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    });
    if (!file) {
      setImportError("Aucun fichier CSV ou Excel détecté dans la sélection déposée.");
      return;
    }
    void importCSVFile(file);
  }

  async function handleReset() {
    const ok = await confirm({
      title: "Remettre à zéro le cycle ?",
      description: "Tous les usages seront effacés pour toutes les entrées. Cette opération est irréversible.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;
    setResetting(true);
    setResetSuccess(null);
    setResetError(null);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/reset`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
    } else {
      const d = await res.json() as { reset: number };
      setResetSuccess(`${d.reset} entrée${d.reset !== 1 ? "s" : ""} réinitialisée${d.reset !== 1 ? "s" : ""}`);
      setTimeout(() => setResetSuccess(null), 4000);
    }
    setResetting(false);
    void load();
  }
  async function handleResetForAccount() {
    if (!accountFilter) return;
    const accountName = accounts.find((a) => a.id === accountFilter)?.handle ?? accountFilter;
    const ok = await confirm({
      title: `Réinitialiser le cycle pour @${accountName} ?`,
      description: "Les usages de ce compte seront effacés. Cette opération est irréversible.",
      confirmLabel: "Réinitialiser",
      variant: "danger",
    });
    if (!ok) return;
    setResettingAccount(true);
    setResetSuccess(null);
    setResetError(null);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: accountFilter }),
    });
    setResettingAccount(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setResetError(d.error ?? "Erreur lors du reset");
    } else {
      const d = await res.json() as { reset: number };
      setResetSuccess(`${d.reset} entrée${d.reset !== 1 ? "s" : ""} réinitialisée${d.reset !== 1 ? "s" : ""} pour @${accountName}`);
      setTimeout(() => setResetSuccess(null), 4000);
      void load();
    }
  }

  async function createBlankEntry() {
    // Phase 1.x design (spreadsheet) — POST une fiche vide puis bump focusBottomSignal
    // pour que la spreadsheet scroll + focus la cellule Set de la nouvelle row.
    try {
      const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setTag: null, category: null, fields: {} }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error ?? "Erreur lors de la création");
        return;
      }
      await load();
      setFocusBottomSignal((n) => n + 1);
    } catch {
      toast.error("Erreur réseau");
    }
  }

  async function handleDeleteEntry(entryId: string) {
    const ok = await confirm({
      title: "Supprimer cette fiche ?",
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${entryId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Erreur lors de la suppression");
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
    toast.success("Fiche supprimée.");
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Supprimer ${ids.length} fiche${ids.length !== 1 ? "s" : ""} ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/admin/libraries/data/campaigns/${campaignId}/entries/${id}`, { method: "DELETE" }),
      ),
    );
    setEntries((prev) => prev.filter((e) => !selectedIds.has(e.id)));
    setSelectedIds(new Set());
    toast.success(`${ids.length} fiche${ids.length !== 1 ? "s" : ""} supprimée${ids.length !== 1 ? "s" : ""}.`);
  }

  const usedCount = entries.filter((e) => e.usedInCycle).length;
  const isPerAccountPolicy = campaign?.usagePolicy === "cycle_per_account" || campaign?.usagePolicy === "once_per_account";
  // Phase 1.x — policy "unlimited" = pas de cycle ni de blocage : on cache
  // le compteur "X ce cycle" (toujours 0) et les boutons "Reset cycle" qui
  // n'ont aucun effet utile.
  const isUnlimitedPolicy = campaign?.usagePolicy === "unlimited";

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pageDragOver && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-sky-500/10 backdrop-blur-[6px] pointer-events-none">
          <div className="rounded-xl bg-gradient-to-b from-white to-white/85 backdrop-blur-[20px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.45),0_8px_24px_-4px_rgba(125,180,210,0.25),0_24px_64px_-12px_rgba(15,23,42,0.22)] px-6 py-4 text-[13px] font-medium text-gray-800">
            Déposez le CSV ou Excel pour importer dans{" "}
            <span className="font-semibold">cette bibliothèque</span>
          </div>
        </div>
      )}

      {/* Actions principales */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[12.5px] text-gray-600">
          {entries.length} fiche{entries.length !== 1 ? "s" : ""} · {schemaFields.length} champ{schemaFields.length !== 1 ? "s" : ""} dans le schéma
          {!isUnlimitedPolicy && (
            <>
              {" · "}
              <span className="tabular-nums">{usedCount}</span> utilisée
              {usedCount !== 1 ? "s" : ""} ce cycle
            </>
          )}
          {accountFilter && isPerAccountPolicy && (
            <span className="ml-1 text-sky-700">
              ·{" "}
              <span className="tabular-nums">
                {entries.filter((e) => e.usageCount > 0).length}
              </span>{" "}
              par ce compte
            </span>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={() =>
              downloadCSVFromColumns(columns, campaign?.name ?? "campagne")
            }
            title={
              columns.length === 0
                ? "Télécharge un modèle minimal (set_tag, category)."
                : "Télécharger le modèle CSV (en-têtes uniquement)"
            }
          >
            Modèle CSV
          </Button>
          {!isUnlimitedPolicy && (accountFilter && isPerAccountPolicy ? (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => {
                void handleResetForAccount();
              }}
              disabled={resettingAccount || entries.length === 0}
              loading={resettingAccount}
              title="Réinitialiser le cycle uniquement pour ce compte"
            >
              Reset ce compte
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => {
                void handleReset();
              }}
              disabled={resetting || entries.length === 0}
              loading={resetting}
            >
              Reset cycle
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            icon={Upload}
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            loading={importing}
          >
            Importer CSV/Excel
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => void createBlankEntry()}
            title="Ajouter une fiche vide en bas de la table (édition inline)"
          >
            Nouvelle fiche
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          onChange={(e) => {
            void handleImport(e);
          }}
          className="hidden"
        />
      </div>

      {/* Filter bar : compte IG si plusieurs */}
      {accounts.length > 0 && (
        <div className="p-3 rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)] mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-[260px]">
              <Combobox
                value={accountFilter ?? ""}
                onChange={(v) => setAccountFilter(v || null)}
                options={[
                  { value: "", label: "Tous les comptes" },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: `@${a.handle} — ${a.name}`,
                    keywords: [a.handle, a.name],
                  })),
                ]}
                placeholder="Tous les comptes"
                emptyMessage="Aucun compte"
              />
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {importError && (
        <div className="mb-4 rounded-xl bg-rose-50/70 backdrop-blur-[8px] px-3 py-2.5 text-[12px] text-rose-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.22)]">
          {importError}
        </div>
      )}
      {importSuccess && (
        <div className="mb-4 rounded-xl bg-sage-50/70 backdrop-blur-[8px] px-3 py-2.5 text-[12px] text-sage-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(111,162,128,0.22)]">
          {importSuccess}
        </div>
      )}
      {resetSuccess && (
        <div className="mb-4 rounded-xl bg-sage-50/70 backdrop-blur-[8px] px-3 py-2.5 text-[12px] text-sage-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(111,162,128,0.22)]">
          ✓ {resetSuccess}
        </div>
      )}
      {resetError && (
        <div className="mb-4 rounded-xl bg-rose-50/70 backdrop-blur-[8px] px-3 py-2.5 text-[12px] text-rose-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.22)]">
          {resetError}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] py-12 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] flex items-center justify-center text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.06)] text-center">
          <p className="text-[14px] font-semibold text-gray-700 mb-2">Aucune entrée pour le moment.</p>
          <p className="mb-3">Glisse-dépose un CSV n&apos;importe où sur la page, ou utilise le bouton ci-dessous.</p>
          <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
            <Button
              variant="primary"
              size="md"
              icon={Upload}
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              loading={importing}
            >
              Importer mon premier CSV
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={Download}
              onClick={() => downloadCSVFromColumns(columns, campaign?.name ?? "campagne")}
            >
              Modèle CSV
            </Button>
          </div>
          <p className="text-[10.5px] text-gray-500 mb-1">
            Colonnes réservées : <code className="bg-white/60 px-1.5 py-0.5 rounded shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] font-mono">set_tag</code>, <code className="bg-white/60 px-1.5 py-0.5 rounded shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] font-mono">category</code>
          </p>
          <p className="text-[10.5px] text-gray-400">
            Astuce : générez le modèle CSV depuis le builder (onglet Paramètres) pour obtenir automatiquement
            les bons en-têtes depuis le schéma de la template.
          </p>
        </div>
      ) : (
        <>
          {/* Bulk action bar (Phase 1.x design) — apparaît quand au moins 1 fiche sélectionnée. */}
          {selectedIds.size > 0 && (
            <div className="mb-3 rounded-xl px-3 py-2 bg-sky-50/60 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)] flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12.5px] font-medium text-sky-700">
                {selectedIds.size} fiche{selectedIds.size > 1 ? "s" : ""} sélectionnée{selectedIds.size > 1 ? "s" : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  Désélectionner
                </Button>
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => void handleBulkDelete()}>
                  Supprimer
                </Button>
              </div>
            </div>
          )}
          <DataEntriesSpreadsheet
            campaignId={campaignId}
            entries={entries.filter(isAccessible)}
            onEntriesChange={setEntries}
            schema={schemaFields}
            selectedKeys={selectedIds}
            onSelectionChange={setSelectedIds}
            focusBottomSignal={focusBottomSignal}
          />
        </>
      )}

      {confirmDialog}
    </div>
  );
}

// ─── Shared: cycle badge ─────────────────────────────────────────────────────


