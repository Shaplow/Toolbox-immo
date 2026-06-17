"use client";

/**
 * ImportPreviewModal — aperçu d'un import CSV/Excel avant commit (dry-run).
 *
 * Affiche le nombre de lignes détectées, les colonnes mappées, la présence des
 * colonnes réservées (set_tag / category), les lignes vides ignorées, et un
 * échantillon des premières fiches. Avertit si la campagne contient déjà des
 * entrées (le commit ajoutera avec force=true). Remplace l'ancien import direct
 * « 0 importé » silencieux.
 */

import { FileSpreadsheet, AlertTriangle, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface ImportPreview {
  detected: number;
  columns: string[];
  reserved: { set_tag: boolean; category: boolean };
  skippedEmpty: number;
  existingCount: number;
  sample: Array<{
    setTag: string | null;
    category: string | null;
    fields: Record<string, string>;
  }>;
}

interface Props {
  preview: ImportPreview;
  fileName: string;
  importing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ImportPreviewModal({
  preview,
  fileName,
  importing,
  onConfirm,
  onClose,
}: Props) {
  const { detected, columns, reserved, skippedEmpty, existingCount, sample } = preview;

  return (
    <Modal open onClose={onClose} size="xl">
      <Modal.Header onClose={onClose}>Aperçu de l&apos;import</Modal.Header>
      <Modal.Body className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] text-foreground">
          <FileSpreadsheet size={16} className="text-muted-foreground" />
          <span className="font-medium truncate">{fileName}</span>
        </div>

        {/* Résumé */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <Stat label="Fiches détectées" value={String(detected)} />
          <Stat label="Colonnes" value={String(columns.length)} />
          <Stat
            label="Lignes vides ignorées"
            value={String(skippedEmpty)}
            muted={skippedEmpty === 0}
          />
          <Stat
            label="Set / Catégorie"
            value={`${reserved.set_tag ? "Set" : "—"} · ${reserved.category ? "Cat." : "—"}`}
          />
        </div>

        {/* Colonnes mappées */}
        {columns.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <span
                key={c}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {/* Avertissement campagne non vide */}
        {existingCount > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-warning-50 border border-warning-200 px-3 py-2 text-[12px] text-warning-700">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              Cette campagne contient déjà <strong>{existingCount}</strong> fiche
              {existingCount > 1 ? "s" : ""}. L&apos;import <strong>ajoutera</strong> les{" "}
              {detected} nouvelle{detected > 1 ? "s" : ""} fiche{detected > 1 ? "s" : ""}.
            </span>
          </div>
        )}

        {/* Échantillon */}
        {sample.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-left">
                  <th className="px-2 py-1.5 font-medium">Set</th>
                  <th className="px-2 py-1.5 font-medium">Catégorie</th>
                  {columns.map((c) => (
                    <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono text-foreground">
                      {row.setTag ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-foreground">{row.category ?? "—"}</td>
                    {columns.map((c) => (
                      <td key={c} className="px-2 py-1.5 text-muted-foreground whitespace-nowrap max-w-[160px] truncate">
                        {row.fields[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {detected > sample.length && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground border-t border-border">
                … et {detected - sample.length} autre{detected - sample.length > 1 ? "s" : ""}.
              </p>
            )}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={importing}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={Check}
          onClick={onConfirm}
          loading={importing}
          disabled={importing || detected === 0}
        >
          Importer {detected} fiche{detected > 1 ? "s" : ""}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-2">
      <p
        className={`text-[15px] font-semibold tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value}
      </p>
      <p className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">{label}</p>
    </div>
  );
}
