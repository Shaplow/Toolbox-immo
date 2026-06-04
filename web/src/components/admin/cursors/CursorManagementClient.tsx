"use client";

/**
 * CursorManagementClient — interface principale de gestion des curseurs de rotation.
 *
 * Affiche :
 *  1. Sélecteur Type (Media | Data) + bibliothèque (Select).
 *  2. CursorAccountList pour la lib sélectionnée.
 *
 * Le rafraîchissement est local (fetch depuis /api/admin/cursors) et ne recharge
 * pas la page entière.
 */

import { useState, useEffect, useCallback } from "react";
import { Library, Database, RefreshCw, BookOpen } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { CursorAccountList } from "./CursorAccountList";
import type { CursorRow } from "./CursorAdjustModal";

type LibraryOption = {
  id: string;
  name: string;
  rotationScope: string;
  /** setSequence JSON string — Media only */
  setSequence?: string;
};

interface Props {
  mediaLibraries: LibraryOption[];
  dataLibraries: LibraryOption[];
}

type CursorType = "media" | "data";

type CursorListResponse = {
  scope: "shared" | "per_account";
  rows: CursorRow[];
};

export function CursorManagementClient({ mediaLibraries, dataLibraries }: Props) {
  const [cursorType, setCursorType] = useState<CursorType>("media");
  const [libraryId, setLibraryId] = useState<string>("");
  const [rows, setRows] = useState<CursorRow[]>([]);
  const [scope, setScope] = useState<"shared" | "per_account">("per_account");
  const [loading, setLoading] = useState(false);

  const libraries = cursorType === "media" ? mediaLibraries : dataLibraries;
  const selectedLib = libraries.find((l) => l.id === libraryId) ?? null;

  // Compute sequence length for Media libs (used by CursorAccountList)
  let sequenceLength = 0;
  if (cursorType === "media" && selectedLib?.setSequence) {
    try {
      const seq = (JSON.parse(selectedLib.setSequence) as string[]).filter(Boolean);
      sequenceLength = seq.length;
    } catch {
      sequenceLength = 0;
    }
  }

  // Reset library selection when type changes
  useEffect(() => {
    setLibraryId("");
    setRows([]);
  }, [cursorType]);

  const fetchCursors = useCallback(async () => {
    if (!libraryId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/cursors?type=${cursorType}&libraryId=${encodeURIComponent(libraryId)}`
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur de chargement");
        return;
      }
      const data = (await res.json()) as CursorListResponse;
      setScope(data.scope);
      setRows(data.rows);
    } catch {
      toast.error("Erreur de chargement des curseurs");
    } finally {
      setLoading(false);
    }
  }, [libraryId, cursorType]);

  useEffect(() => {
    void fetchCursors();
  }, [fetchCursors]);

  const typeOptions = [
    { value: "media", label: "Bibliothèques vidéo" },
    { value: "data", label: "Bibliothèques de données" },
  ];

  const libraryOptions = libraries.map((l) => ({
    value: l.id,
    label: l.name,
  }));

  return (
    <div className="space-y-6">
      {/* ── Sélecteurs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Type">
          <Select
            value={cursorType}
            onChange={(v) => setCursorType(v as CursorType)}
            options={typeOptions}
            icon={cursorType === "media" ? Library : Database}
          />
        </FormField>

        <FormField label="Bibliothèque">
          <Select
            value={libraryId}
            onChange={setLibraryId}
            options={libraryOptions}
            placeholder="Choisir une bibliothèque…"
            disabled={libraries.length === 0}
          />
        </FormField>
      </div>

      {/* ── Infos bibliothèque sélectionnée ──────────────────── */}
      {selectedLib && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-white/40 backdrop-blur-[6px] border border-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-gray-900">{selectedLib.name}</span>
              <span className="text-[11px] text-gray-500">
                Scope :{" "}
                <span className={scope === "shared" ? "text-sky-700 font-medium" : "text-sage-700 font-medium"}>
                  {scope === "shared" ? "Partagé (curseur global)" : "Par compte (curseurs indépendants)"}
                </span>
                {cursorType === "media" && sequenceLength > 0 && (
                  <> · setSequence : <span className="font-mono">{sequenceLength} slots</span></>
                )}
                {cursorType === "media" && sequenceLength === 0 && (
                  <> · Mode auto (round-robin least-used)</>
                )}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={() => void fetchCursors()}
          >
            Rafraîchir
          </Button>
        </div>
      )}

      {/* ── Table curseurs ─────────────────────────────────────── */}
      {!libraryId ? (
        <EmptyState
          icon={BookOpen}
          title="Sélectionner une bibliothèque"
          description="Choisissez un type et une bibliothèque pour visualiser et ajuster les curseurs de rotation."
        />
      ) : (
        <CursorAccountList
          type={cursorType}
          libraryId={libraryId}
          rows={rows}
          loading={loading}
          sequenceLength={sequenceLength}
          onRowsChange={setRows}
        />
      )}

      {/* ── Légende ────────────────────────────────────────────── */}
      {libraryId && !loading && rows.length > 0 && (
        <div className="px-4 py-3 rounded-xl bg-gray-50/60 border border-gray-100/80 text-[11px] text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">Rappel rotation</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              <strong>Cursor</strong> (Media) : index dans setSequence (mode override). En mode auto, il est ignoré.
            </li>
            <li>
              <strong>Last setTag / catégorie</strong> : valeurs utilisées lors de la dernière sélection.
              Effacer = la prochaine sélection choisit sans exclusion consécutive.
            </li>
            <li>
              <strong>Reset</strong> remet cursor → 0 et efface lastUsedSetTag/Category.
            </li>
            <li>
              <strong>Jump to…</strong> permet de définir précisément chaque valeur.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
