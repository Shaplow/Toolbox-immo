"use client";

/**
 * CursorSectionForLibrary — section "Curseurs de rotation" à intégrer en
 * contexte d'une fiche MediaLibrary ou DataLibrary.
 *
 * Wrapper minimal au-dessus de CursorAccountList : le type et la lib sont
 * fixés (fournis en props), donc plus de sélecteur en tête. Permet de
 * remplacer la page top-level /admin/cursors par un bloc en bas de la fiche
 * lib, plus naturel en termes de flow admin.
 */

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { CursorAccountList } from "@/components/admin/cursors/CursorAccountList";
import type { CursorRow } from "@/components/admin/cursors/CursorAdjustModal";

interface Props {
  libraryId: string;
  /** "media" pour MediaLibrary, "data" pour DataLibrary. */
  libraryType: "media" | "data";
  /** setSequence JSON string (MediaLibrary uniquement). */
  setSequence?: string | null;
  /** Le scope de rotation de la lib (sert juste pour le label affiché). */
  rotationScope?: "shared" | "per_account";
}

type CursorListResponse = {
  scope: "shared" | "per_account";
  rows: CursorRow[];
};

export function CursorSectionForLibrary({
  libraryId,
  libraryType,
  setSequence,
  rotationScope: initialScope,
}: Props) {
  const [rows, setRows] = useState<CursorRow[]>([]);
  const [scope, setScope] = useState<"shared" | "per_account">(
    initialScope ?? "per_account",
  );
  const [loading, setLoading] = useState(false);

  // setSequence est stocké sous forme JSON string en DB (cohérence avec
  // l'éditeur MediaLibrary). Comptage utilisé par CursorAccountList pour
  // borner le picker "Cursor".
  let sequenceLength = 0;
  if (libraryType === "media" && setSequence) {
    try {
      const seq = (JSON.parse(setSequence) as string[]).filter(Boolean);
      sequenceLength = seq.length;
    } catch {
      sequenceLength = 0;
    }
  }

  const fetchCursors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/cursors?type=${libraryType}&libraryId=${encodeURIComponent(libraryId)}`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Erreur de chargement des curseurs");
        return;
      }
      const data = (await res.json()) as CursorListResponse;
      setScope(data.scope);
      setRows(data.rows);
    } catch {
      toast.error("Erreur réseau curseurs");
    } finally {
      setLoading(false);
    }
  }, [libraryId, libraryType]);

  useEffect(() => {
    void fetchCursors();
  }, [fetchCursors]);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">
            Curseurs de rotation
          </h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            État de la rotation par compte pour cette bibliothèque ·{" "}
            <span
              className={
                scope === "shared"
                  ? "text-sky-700 font-medium"
                  : "text-sage-700 font-medium"
              }
            >
              {scope === "shared"
                ? "Curseur partagé (global)"
                : "Curseurs indépendants par compte"}
            </span>
            {libraryType === "media" && sequenceLength > 0 && (
              <>
                {" · "}setSequence :{" "}
                <span className="font-mono">{sequenceLength} slots</span>
              </>
            )}
            {libraryType === "media" && sequenceLength === 0 && (
              <> · Mode auto (round-robin least-used)</>
            )}
          </p>
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
      </header>

      <CursorAccountList
        type={libraryType}
        libraryId={libraryId}
        rows={rows}
        loading={loading}
        sequenceLength={sequenceLength}
        onRowsChange={setRows}
      />

      {!loading && rows.length > 0 && (
        <div className="px-4 py-3 rounded-xl bg-gray-50/60 border border-gray-100/80 text-[11px] text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">Rappel rotation</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              <strong>Cursor</strong> (Media) : index dans setSequence. En mode auto, il est ignoré.
            </li>
            <li>
              <strong>Last setTag / catégorie</strong> : valeurs utilisées lors de la dernière sélection. Effacer = la prochaine sélection choisit sans exclusion consécutive.
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
    </section>
  );
}
