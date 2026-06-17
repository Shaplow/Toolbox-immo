"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Upload, RotateCcw, Download, Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
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

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Exporte les entries actuelles en CSV (vérification visuelle de l'état BDD).
 * Format identique à celui attendu par l'import : `set_tag,category,<champs>`.
 * Filename : `data-{campaignName}-{YYYY-MM-DD}.csv`.
 */
function downloadCSVFromEntries(
  entries: DataEntry[],
  columns: string[],
  campaignName: string,
) {
  const headers = ["set_tag", "category", ...columns];
  const lines = [headers.map(csvEscape).join(",")];
  for (const entry of entries) {
    let fields: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(entry.fields);
      if (parsed && typeof parsed === "object") fields = parsed as Record<string, unknown>;
    } catch {
      // entry.fields corrompu — on émet une ligne avec colonnes vides
    }
    const row = [
      entry.setTag ?? "",
      entry.category ?? "",
      ...columns.map((col) => {
        const v = fields[col];
        if (v == null) return "";
        return String(v);
      }),
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  const csv = lines.join("\n");
  // Pas de BOM UTF-8 : parseCSV de l'import ne le strip pas et casserait
  // le ré-import (la 1ʳᵉ colonne deviendrait "﻿set_tag").
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  const safeName = campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  a.href = url;
  a.download = `data-${safeName}-${today}.csv`;
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
import { useBulkEditDataEntries } from "@/components/admin/libraries/dataEntries/useBulkEditDataEntries";
import { DataEntriesBulkActionBar } from "@/components/admin/libraries/dataEntries/DataEntriesBulkActionBar";
import {
  ImportPreviewModal,
  type ImportPreview,
} from "@/components/admin/libraries/dataEntries/ImportPreviewModal";

export function DataEntriesPanel({ campaignId, libraryId, fieldsSchema }: Props) {
  // Phase 1.x — schéma de champs au niveau lib (source de vérité).
  const declaredSchema = useMemo(() => parseFieldsSchema(fieldsSchema), [fieldsSchema]);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [campaign, setCampaign] = useState<DataCampaign | null>(null);
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  // Recherche texte (Set / catégorie / valeurs de champs). Filtre client-side
  // appliqué avant le scoping accès, comme accountFilter.
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  // Dry-run : preview + fichier en attente de confirmation.
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resettingAccount, setResettingAccount] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Phase 1.x design (spreadsheet) — édition inline, plus de drawer.
  // focusBottomSignal bump à chaque création vide pour que la spreadsheet
  // scroll + focus la cellule Set de la dernière row.
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

  // Hook bulk edit access — sélection multi-row + actions accès comptes.
  const bulk = useBulkEditDataEntries({ campaignId, accounts, reload: load });

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

  /** Étape 1 — dry-run : parse le fichier côté serveur SANS insérer et ouvre
   *  la modal d'aperçu. Appelé depuis le drop-zone ET le <input type="file">. */
  async function requestImportPreview(file: File) {
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `/api/admin/libraries/data/campaigns/${campaignId}/import?dry=true`,
        { method: "POST", body: formData },
      );
      const d = (await res.json().catch(() => ({}))) as
        | (ImportPreview & { dryRun: true })
        | { error?: string };
      if (!res.ok || !("dryRun" in d)) {
        setImportError(
          ("error" in d && d.error) || "Aucune ligne valide détectée dans le fichier.",
        );
        return;
      }
      setImportPreview(d);
      setPendingFile(file);
    } catch {
      setImportError("Erreur réseau lors de l'analyse du fichier.");
    } finally {
      setImporting(false);
    }
  }

  /** Étape 2 — commit : import réel (avec force si la campagne est non vide). */
  async function confirmImport() {
    if (!pendingFile) return;
    setImporting(true);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      if (importPreview && importPreview.existingCount > 0) {
        formData.append("force", "true");
      }
      const res = await fetch(
        `/api/admin/libraries/data/campaigns/${campaignId}/import`,
        { method: "POST", body: formData },
      );
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setImportError(d.error ?? "Erreur lors de l'import");
        return;
      }
      const d = (await res.json()) as { imported: number };
      setImportSuccess(
        `${d.imported} entrée${d.imported !== 1 ? "s" : ""} importée${d.imported !== 1 ? "s" : ""} avec succès`,
      );
      setImportPreview(null);
      setPendingFile(null);
      setSearch("");
      void load();
    } catch {
      setImportError("Erreur réseau — import annulé.");
    } finally {
      setImporting(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await requestImportPreview(file);
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
    void requestImportPreview(file);
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
      // Clear la recherche : une fiche vide (Set/catégorie null) ne matcherait
      // pas une requête active et resterait invisible.
      setSearch("");
      await load();
      setFocusBottomSignal((n) => n + 1);
    } catch {
      toast.error("Erreur réseau");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(bulk.selectedIds);
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
    setEntries((prev) => prev.filter((e) => !bulk.selectedIds.has(e.id)));
    bulk.clearSelection();
    toast.success(`${ids.length} fiche${ids.length !== 1 ? "s" : ""} supprimée${ids.length !== 1 ? "s" : ""}.`);
  }

  const usedCount = entries.filter((e) => e.usedInCycle).length;
  const isPerAccountPolicy = campaign?.usagePolicy === "cycle_per_account" || campaign?.usagePolicy === "once_per_account";
  // Phase 1.x — policy "unlimited" = pas de cycle ni de blocage : on cache
  // le compteur "X ce cycle" (toujours 0) et les boutons "Reset cycle" qui
  // n'ont aucun effet utile.
  const isUnlimitedPolicy = campaign?.usagePolicy === "unlimited";

  // Recherche : Set / catégorie / valeurs de champs (insensible à la casse).
  const matchesSearch = useCallback(
    (entry: DataEntry) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      if ((entry.setTag ?? "").toLowerCase().includes(q)) return true;
      if ((entry.category ?? "").toLowerCase().includes(q)) return true;
      try {
        const f = JSON.parse(entry.fields) as Record<string, unknown>;
        return Object.values(f).some(
          (v) => v != null && String(v).toLowerCase().includes(q),
        );
      } catch {
        return false;
      }
    },
    [search],
  );

  const accessibleEntries = useMemo(
    () => entries.filter(isAccessible),
    [entries, isAccessible],
  );
  const visibleEntries = useMemo(
    () => accessibleEntries.filter(matchesSearch),
    [accessibleEntries, matchesSearch],
  );
  // Lignes masquées (non accessibles OU filtrées par la recherche) : à conserver
  // dans le state quand la spreadsheet renvoie sa liste filtrée éditée — sinon
  // l'édition d'une ligne effacerait les autres du state.
  const visibleIds = useMemo(
    () => new Set(visibleEntries.map((e) => e.id)),
    [visibleEntries],
  );
  const hiddenEntries = useMemo(
    () => entries.filter((e) => !visibleIds.has(e.id)),
    [entries, visibleIds],
  );

  // Suggestions pour les Combobox bulk Set / catégorie (valeurs existantes).
  const setTagOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.setTag).filter((s): s is string => !!s))).sort(),
    [entries],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.category).filter((c): c is string => !!c))).sort(),
    [entries],
  );

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pageDragOver && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-info-600/10 pointer-events-none">
          <div className="rounded-xl bg-gradient-to-b from-white to-white/85  px-6 py-4 text-[13px] font-medium text-gray-800">
            Déposez le CSV ou Excel pour importer dans{" "}
            <span className="font-semibold">cette bibliothèque</span>
          </div>
        </div>
      )}

      {/* Actions principales */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[12.5px] text-muted-foreground">
          {entries.length} fiche{entries.length !== 1 ? "s" : ""} · {schemaFields.length} champ{schemaFields.length !== 1 ? "s" : ""} dans le schéma
          {!isUnlimitedPolicy && (
            <>
              {" · "}
              <span className="tabular-nums">{usedCount}</span> utilisée
              {usedCount !== 1 ? "s" : ""} ce cycle
            </>
          )}
          {accountFilter && isPerAccountPolicy && (
            <span className="ml-1 text-info-700">
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
            icon={Download}
            onClick={() =>
              downloadCSVFromEntries(entries, columns, campaign?.name ?? "campagne")
            }
            disabled={entries.length === 0}
            title="Télécharger les entrées actuelles au format CSV"
          >
            Exporter CSV
          </Button>
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

      {/* Filter bar : recherche texte + compte IG si plusieurs */}
      <div className="p-3 rounded-2xl bg-card border border-border mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-[280px]">
            <Input
              value={search}
              onChange={setSearch}
              icon={Search}
              placeholder="Rechercher (Set, catégorie, valeurs…)"
              trailing={
                search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="text-muted-foreground hover:text-foreground text-[11px]"
                    aria-label="Effacer la recherche"
                  >
                    ✕
                  </button>
                ) : undefined
              }
            />
          </div>
          {accounts.length > 0 && (
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
          )}
          {search && (
            <span className="text-[11.5px] text-muted-foreground tabular-nums">
              {visibleEntries.length} résultat{visibleEntries.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Alerts */}
      {importError && (
        <div className="mb-4 rounded-xl bg-danger-50/70 px-3 py-2.5 text-[12px] text-danger-700 ">
          {importError}
        </div>
      )}
      {importSuccess && (
        <div className="mb-4 rounded-xl bg-success-50/70 px-3 py-2.5 text-[12px] text-success-700 ">
          {importSuccess}
        </div>
      )}
      {resetSuccess && (
        <div className="mb-4 rounded-xl bg-success-50/70 px-3 py-2.5 text-[12px] text-success-700 ">
          ✓ {resetSuccess}
        </div>
      )}
      {resetError && (
        <div className="mb-4 rounded-xl bg-danger-50/70 px-3 py-2.5 text-[12px] text-danger-700 ">
          {resetError}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-card border border-border py-12  flex items-center justify-center text-muted-foreground gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8  text-center">
          <p className="text-[14px] font-semibold text-foreground mb-2">Aucune entrée pour le moment.</p>
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
          <p className="text-[10.5px] text-muted-foreground mb-1">
            Colonnes réservées : <code className="bg-white/60 px-1.5 py-0.5 rounded shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] font-mono">set_tag</code>, <code className="bg-white/60 px-1.5 py-0.5 rounded shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] font-mono">category</code>
          </p>
          <p className="text-[10.5px] text-muted-foreground">
            Astuce : générez le modèle CSV depuis le builder (onglet Paramètres) pour obtenir automatiquement
            les bons en-têtes depuis le schéma de la template.
          </p>
        </div>
      ) : (
        <>
          {/* Bulk action bar — delete + accès comptes IG. Apparaît quand ≥1 fiche sélectionnée. */}
          {bulk.selectedIds.size > 0 && (
            <div className="mb-3 rounded-xl px-3 py-2 bg-info-50/60  flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12.5px] font-medium text-info-700">
                {bulk.selectedIds.size} fiche{bulk.selectedIds.size > 1 ? "s" : ""} sélectionnée{bulk.selectedIds.size > 1 ? "s" : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={bulk.clearSelection}>
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
            entries={visibleEntries}
            onEntriesChange={(next) => setEntries([...hiddenEntries, ...next])}
            schema={schemaFields}
            selectedKeys={bulk.selectedIds}
            onSelectionChange={bulk.setSelectedIds}
            focusBottomSignal={focusBottomSignal}
            accounts={accounts}
          />
          {/* Sticky bar bulk (Set / catégorie / accès) — dès qu'une fiche est
              sélectionnée (le sélecteur compte est masqué si aucun compte). */}
          {bulk.selectedIds.size > 0 && (
            <DataEntriesBulkActionBar
              bulk={bulk}
              allVisibleIds={visibleEntries.map((e) => e.id)}
              accounts={accounts}
              setTagOptions={setTagOptions}
              categoryOptions={categoryOptions}
            />
          )}
        </>
      )}

      {importPreview && pendingFile && (
        <ImportPreviewModal
          preview={importPreview}
          fileName={pendingFile.name}
          importing={importing}
          onConfirm={() => void confirmImport()}
          onClose={() => {
            setImportPreview(null);
            setPendingFile(null);
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}

// ─── Shared: cycle badge ─────────────────────────────────────────────────────


