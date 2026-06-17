"use client";

/**
 * AllCursorsForAccountDrawer — Sprint D.
 *
 * Drawer admin qui affiche tous les curseurs de rotation (Media + Data)
 * pour un compte Instagram donné, en cross-libs. Évite de devoir naviguer
 * lib par lib pour faire un état des lieux ou un reset global.
 *
 * Actions :
 *  - Reset tous les curseurs Media (resp. Data) via POST
 *    /api/admin/accounts/[id]/cursors/reset.
 *  - Ajustement individuel via CursorAdjustModal (réutilisé).
 */

import { useEffect, useState } from "react";
import { RotateCw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { Inbox } from "lucide-react";
import {
  CursorAdjustModal,
  type CursorRow,
} from "./CursorAdjustModal";
import { rotationScopeLabel } from "@/lib/i18n/entityLabels";

interface Props {
  accountId: string;
  accountHandle: string;
  onClose: () => void;
}

interface MediaCursor {
  id: string;
  libraryId: string;
  libraryName: string;
  libraryType: string;
  cursor: number;
  lastUsedSetTag: string | null;
  lastUsedCategory: string | null;
  lastAdvancedAt: string | null;
  rotationScope: string;
  /** Clé réelle du curseur (sentinelle en shared) — pour l'ajustement. */
  cursorAccountId: string;
  sequenceLength: number;
}

interface DataCursor {
  id: string;
  libraryId: string;
  libraryName: string;
  templateType: string;
  lastUsedSetTag: string | null;
  lastUsedCategory: string | null;
  lastAdvancedAt: string | null;
  rotationScope: string;
  cursorAccountId: string;
}

export function AllCursorsForAccountDrawer({
  accountId,
  accountHandle,
  onClose,
}: Props) {
  const [mediaCursors, setMediaCursors] = useState<MediaCursor[]>([]);
  const [dataCursors, setDataCursors] = useState<DataCursor[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [adjustingRow, setAdjustingRow] = useState<CursorRow | null>(null);
  const [adjustType, setAdjustType] = useState<"media" | "data">("media");
  const [adjustLibraryId, setAdjustLibraryId] = useState<string>("");
  const [adjustSequenceLength, setAdjustSequenceLength] = useState<number>(0);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/cursors/by-account/${accountId}`,
      );
      if (!res.ok) {
        toast.error("Erreur de chargement des curseurs");
        return;
      }
      const data = (await res.json()) as {
        mediaCursors: MediaCursor[];
        dataCursors: DataCursor[];
      };
      setMediaCursors(data.mediaCursors);
      setDataCursors(data.dataCursors);
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function performReset() {
    setResetting(true);
    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/cursors/reset`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      toast.success("Curseurs réinitialisés");
      setResetConfirmOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setResetting(false);
    }
  }

  function openAdjust(
    type: "media" | "data",
    libraryId: string,
    row: CursorRow,
    sequenceLength: number,
  ) {
    setAdjustType(type);
    setAdjustLibraryId(libraryId);
    setAdjustingRow(row);
    setAdjustSequenceLength(sequenceLength);
  }

  return (
    <Drawer open onClose={onClose} side="right" size="lg">
      <header className="shrink-0 px-5 pt-5 pb-3 border-b border-white/30 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
            Rotation cross-libs
          </p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-foreground">
            Curseurs de @{accountHandle}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Vue agrégée Media + Data. Reset global possible.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => void refresh()}
            loading={loading}
          >
            Rafraîchir
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={RotateCw}
            onClick={() => setResetConfirmOpen(true)}
            loading={resetting}
            disabled={
              loading || (mediaCursors.length === 0 && dataCursors.length === 0)
            }
          >
            Reset tout
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Media */}
        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-widest text-foreground mb-3">
            Bibliothèques vidéo · {mediaCursors.length}
          </h3>
          {mediaCursors.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucun curseur Media"
              description="Aucune bibliothèque vidéo n'a encore été utilisée par ce compte."
            />
          ) : (
            <ul className="space-y-1.5">
              {mediaCursors.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2 "
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-foreground truncate">
                      {c.libraryName}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Cursor:{" "}
                      <span className="font-mono">
                        {c.cursor}
                        {c.sequenceLength > 0 ? `/${c.sequenceLength}` : ""}
                      </span>
                      {c.lastUsedSetTag && (
                        <>
                          {" "}
                          · set: <span className="font-mono">{c.lastUsedSetTag}</span>
                        </>
                      )}
                      {c.lastUsedCategory && (
                        <>
                          {" "}
                          · catég: {c.lastUsedCategory}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 inline-flex items-center gap-2">
                    <Chip
                      variant={c.rotationScope === "shared" ? "sky" : "sage"}
                      size="sm"
                    >
                      {rotationScopeLabel(c.rotationScope)}
                    </Chip>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openAdjust(
                          "media",
                          c.libraryId,
                          {
                            // En shared, cible la sentinelle (curseur global).
                            accountId: c.cursorAccountId,
                            handle: accountHandle,
                            isShared: c.rotationScope === "shared",
                            cursor: c.cursor,
                            lastUsedSetTag: c.lastUsedSetTag,
                            lastUsedCategory: c.lastUsedCategory,
                            lastAdvancedAt: c.lastAdvancedAt,
                          },
                          c.sequenceLength,
                        )
                      }
                    >
                      Ajuster
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Data */}
        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-widest text-foreground mb-3">
            Bibliothèques données · {dataCursors.length}
          </h3>
          {dataCursors.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Aucun curseur Data"
              description="Aucune bibliothèque de données n'a encore été utilisée par ce compte."
            />
          ) : (
            <ul className="space-y-1.5">
              {dataCursors.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2 "
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-foreground truncate">
                      {c.libraryName}{" "}
                      <span className="text-muted-foreground font-normal">
                        · {c.templateType}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {c.lastUsedSetTag && (
                        <>
                          set: <span className="font-mono">{c.lastUsedSetTag}</span>
                        </>
                      )}
                      {c.lastUsedCategory && (
                        <>
                          {c.lastUsedSetTag ? " · " : ""}catég:{" "}
                          {c.lastUsedCategory}
                        </>
                      )}
                      {!c.lastUsedSetTag && !c.lastUsedCategory && "Vierge"}
                    </p>
                  </div>
                  <div className="shrink-0 inline-flex items-center gap-2">
                    <Chip
                      variant={c.rotationScope === "shared" ? "sky" : "sage"}
                      size="sm"
                    >
                      {rotationScopeLabel(c.rotationScope)}
                    </Chip>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        openAdjust(
                          "data",
                          c.libraryId,
                          {
                            // En shared, cible la sentinelle (curseur global).
                            accountId: c.cursorAccountId,
                            handle: accountHandle,
                            isShared: c.rotationScope === "shared",
                            cursor: 0,
                            lastUsedSetTag: c.lastUsedSetTag,
                            lastUsedCategory: c.lastUsedCategory,
                            lastAdvancedAt: c.lastAdvancedAt,
                          },
                          0,
                        )
                      }
                    >
                      Ajuster
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {adjustingRow && (
        <CursorAdjustModal
          open
          type={adjustType}
          libraryId={adjustLibraryId}
          row={adjustingRow}
          sequenceLength={adjustSequenceLength}
          onUpdated={() => {
            setAdjustingRow(null);
            void refresh();
          }}
          onClose={() => setAdjustingRow(null)}
        />
      )}

      <ConfirmDialog
        open={resetConfirmOpen}
        title="Réinitialiser tous les curseurs ?"
        description={`Les curseurs propres au compte @${accountHandle} seront remis à zéro. Les curseurs partagés (globaux) ne sont pas affectés — ajuste-les individuellement (ils impactent tous les comptes). Action irréversible.`}
        confirmLabel="Réinitialiser"
        variant="danger"
        loading={resetting}
        onConfirm={() => void performReset()}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </Drawer>
  );
}
