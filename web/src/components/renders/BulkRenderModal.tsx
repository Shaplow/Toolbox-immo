"use client";

/**
 * BulkRenderModal — aperçu puis lancement en lot des rendus (plan « Lancer
 * les rendus depuis le calendrier », étape 8).
 *
 * Toujours montée par ses appelants (CalendarView, SlotDetailPanel,
 * RenderSection) avec `open` qui pilote sa visibilité — sur `open: true` elle
 * recharge l'aperçu depuis `slotIds`, jamais de cache d'un ouverture à
 * l'autre. Le geste unitaire (fiche, tiroir) l'ouvre avec un seul id : même
 * modale, une seule ligne.
 *
 * Principe non négociable (voir `types/bulkRender.ts`) : le lancement envoie
 * les picks EXACTS de l'aperçu, éventuellement modifiés via « Changer ». Le
 * serveur ne re-tire jamais un média.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { PARIS_TZ, parisDayKey, timeFr } from "@/lib/date/formatFr";
import { BulkRenderRow } from "./BulkRenderRow";
import type {
  BulkRenderPreview,
  BulkRenderRow as BulkRenderRowType,
  BulkRenderLaunchItem,
  BulkRenderLaunchResponse,
  BulkRenderLaunchResult,
} from "@/types/bulkRender";
import type { LibraryAssetOption } from "@/types/libraryPrefill";

interface Props {
  slotIds: string[];
  open: boolean;
  onClose: () => void;
  onLaunched?: () => void;
}

interface DayGroup {
  key: string;
  label: string;
  rows: BulkRenderRowType[];
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/** « Jeudi 21 août » — même trio weekday/day/month long que `SlotDetailPanel` (scheduledDateLabel). */
function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  // Bespoke (weekday long + jour + mois long, sans année) sans équivalent
  // dans lib/date/formatFr.ts — même dérogation que SlotDetailPanel/CalendarView.
  // eslint-disable-next-line no-restricted-syntax
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: PARIS_TZ });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** « jeu. 14:00 » — pour le badge de doublon. */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  // eslint-disable-next-line no-restricted-syntax
  const weekday = d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: PARIS_TZ });
  return `${weekday} ${timeFr(d)}`;
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Skeleton shape="block" className="h-4 w-4" />
            <Skeleton className="w-10" />
            <Skeleton className="w-20" />
            <Skeleton className="w-32" />
          </div>
          <Skeleton shape="block" className="mt-2 h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

export function BulkRenderModal({ slotIds, open, onClose, onLaunched }: Props) {
  const [preview, setPreview] = useState<BulkRenderPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRenderRowType[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [changedBlockIds, setChangedBlockIds] = useState<Map<string, Set<string>>>(new Map());
  const [launching, setLaunching] = useState(false);
  const [launchResults, setLaunchResults] = useState<Map<string, BulkRenderLaunchResult>>(new Map());

  const loading = preview === null && previewError === null;

  // Une seule modale montée pour les 4 points d'entrée calendrier : sans
  // garde, une réponse d'aperçu tardive (lot A annulé, lot B ouvert et résolu
  // plus vite) peindrait le lot A par-dessus le B. Incrémenté à chaque appel
  // et à la fermeture — toute réponse dont l'id ne correspond plus au courant
  // est ignorée.
  const previewReqIdRef = useRef(0);
  // Un lancement partiel (certaines lignes ok, d'autres en échec, modale
  // laissée ouverte) doit tout de même faire recharger le calendrier à la
  // fermeture — sinon les publications lancées restent affichées comme si
  // rien n'avait démarré. Remis à zéro à chaque ouverture.
  const launchedAnyRef = useRef(false);

  const loadPreview = useCallback(async () => {
    const reqId = ++previewReqIdRef.current;
    if (slotIds.length === 0) {
      setPreview({ rows: [], ignored: [], deferred: 0, cap: 0 });
      return;
    }
    try {
      const res = await fetch("/api/calendar/renders/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as BulkRenderPreview;
      if (reqId !== previewReqIdRef.current) return;
      setPreview(data);
      setRows(data.rows);
      setCheckedIds(
        new Set(data.rows.filter((r) => r.status === "ready" && !r.overdue).map((r) => r.slotId)),
      );
    } catch (err) {
      if (reqId !== previewReqIdRef.current) return;
      setPreviewError(err instanceof Error ? err.message : "Chargement de l'aperçu impossible");
    }
  }, [slotIds]);

  useEffect(() => {
    if (!open) return;
    launchedAnyRef.current = false;
    void loadPreview();
    return () => {
      // Invalide toute réponse en vol et vide l'état affiché : au prochain
      // open, on ne doit jamais flasher le lot précédent (rows/checked/
      // résultats de lancement) avant que le nouvel aperçu n'arrive.
      previewReqIdRef.current += 1;
      setPreview(null);
      setPreviewError(null);
      setRows([]);
      setCheckedIds(new Set());
      setChangedBlockIds(new Map());
      setLaunchResults(new Map());
    };
    // Volontairement sur la seule transition d'ouverture — un `slotIds`
    // recréé à chaque rendu par l'appelant ne doit pas relancer l'aperçu en
    // boucle tant que la modale reste ouverte sur le même lot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleModalClose = useCallback(() => {
    if (launching) return;
    onClose();
    // Un lot partiellement lancé a laissé des rendus tourner sur des slots
    // que le calendrier affiche encore comme "rien en cours" — recharger.
    if (launchedAnyRef.current) onLaunched?.();
  }, [launching, onClose, onLaunched]);

  function handleMediaChange(slotId: string, blockId: string, asset: LibraryAssetOption) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.slotId !== slotId) return r;
        return {
          ...r,
          media: r.media.map((m) =>
            m.blockId === blockId
              ? {
                  ...m,
                  asset: {
                    id: asset.id,
                    url: asset.url,
                    filename: asset.filename,
                    posterUrl: asset.posterUrl ?? null,
                    duration: asset.duration ?? null,
                    setTag: asset.setTag ?? null,
                  },
                }
              : m,
          ),
        };
      }),
    );
    setChangedBlockIds((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(slotId) ?? []);
      set.add(blockId);
      next.set(slotId, set);
      return next;
    });
  }

  function toggleChecked(slotId: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slotId);
      else next.delete(slotId);
      return next;
    });
  }

  // ── Groupement par jour — les lignes arrivent déjà triées chronologiquement
  // (compareForBulk côté serveur, null en dernier) : on préserve cet ordre,
  // le tri défensif ci-dessous ne fait que garantir « Sans date » en dernier
  // si jamais l'ordre d'entrée changeait.
  const dayGroups = useMemo<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    const byKey = new Map<string, DayGroup>();
    for (const r of rows) {
      const key = r.scheduledAt ? parisDayKey(r.scheduledAt) : "no-date";
      let g = byKey.get(key);
      if (!g) {
        g = { key, label: r.scheduledAt ? dayGroupLabel(r.scheduledAt) : "Sans date", rows: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.rows.push(r);
    }
    groups.sort((a, b) => (a.key === "no-date" ? 1 : b.key === "no-date" ? -1 : 0));
    return groups;
  }, [rows]);

  // ── Doublons — même asset (même usageKey) dans une autre ligne COCHÉE.
  // Averti seulement, jamais bloquant : typiquement le résultat d'un
  // « Changer » qui recolle sur un pick déjà pris par une autre ligne.
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, { slotId: string; blockId: string }[]>();
    for (const r of rows) {
      if (r.status !== "ready" || !checkedIds.has(r.slotId)) continue;
      for (const m of r.media) {
        if (!m.asset) continue;
        const key = `${m.usageKey}::${m.asset.id}`;
        const list = groups.get(key) ?? [];
        list.push({ slotId: r.slotId, blockId: m.blockId });
        groups.set(key, list);
      }
    }
    return groups;
  }, [rows, checkedIds]);

  const rowBySlotId = useMemo(() => new Map(rows.map((r) => [r.slotId, r])), [rows]);

  const duplicateLabelFor = useCallback(
    (slotId: string, blockId: string, usageKey: string, assetId: string): string | null => {
      // Une ligne décochée n'est jamais dans `duplicateGroups` (voir
      // ci-dessus), mais peut quand même être appelée ici : sans cette garde,
      // elle affichait parfois le badge d'une paire d'autres lignes cochées
      // (0 vs 2 partages cochés donnait des résultats incohérents).
      if (!checkedIds.has(slotId)) return null;
      const list = duplicateGroups.get(`${usageKey}::${assetId}`);
      if (!list || list.length < 2) return null;
      // Cible une AUTRE publication d'abord — deux blocs de cette même ligne
      // (même slotId) qui partagent l'asset (RVA3, ou un "Changer" qui
      // recolle sur un pick sœur) ne sont pas un conflit entre publications.
      const other = list.find((it) => it.slotId !== slotId);
      if (other) {
        const otherRow = rowBySlotId.get(other.slotId);
        if (!otherRow) return null;
        const when = otherRow.scheduledAt ? shortWhen(otherRow.scheduledAt) : "Sans date";
        const handle = otherRow.account?.handle;
        return `Aussi utilisé : ${when}${handle ? ` · @${handle}` : ""}`;
      }
      const sameRowOther = list.find((it) => !(it.slotId === slotId && it.blockId === blockId));
      if (sameRowOther) return "Utilisé deux fois dans cette vidéo";
      return null;
    },
    [checkedIds, duplicateGroups, rowBySlotId],
  );

  const readyCount = rows.filter((r) => r.status === "ready").length;
  const manualCount = rows.length - readyCount;
  const ignoredCount = preview?.ignored.reduce((sum, i) => sum + i.count, 0) ?? 0;
  const deferredCount = preview?.deferred ?? 0;

  const summaryLine =
    `${readyCount} ${pluralize(readyCount, "prête", "prêtes")} · ${manualCount} à faire à la main · ` +
    `${ignoredCount} ${pluralize(ignoredCount, "non concernée", "non concernées")}` +
    (deferredCount > 0
      ? ` · ${deferredCount} ${pluralize(deferredCount, "reportée", "reportées")} au prochain lot`
      : "");

  async function handleLaunch() {
    const items: BulkRenderLaunchItem[] = rows
      .filter((r) => r.status === "ready" && checkedIds.has(r.slotId))
      .map((r) => {
        const videoAssets: Record<string, string> = {};
        let audioAssetId: string | null | undefined;
        for (const m of r.media) {
          if (!m.asset) continue;
          if (m.kind === "video") videoAssets[m.blockId] = m.asset.id;
          else audioAssetId = m.asset.id;
        }
        return {
          slotId: r.slotId,
          videoAssets,
          audioAssetId,
          dataEntryId: r.data?.entryId ?? null,
          changedBlockIds: Array.from(changedBlockIds.get(r.slotId) ?? []),
        };
      });
    if (items.length === 0) return;

    setLaunching(true);
    try {
      const res = await fetch("/api/calendar/renders/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as BulkRenderLaunchResponse;
      const ok = data.results.filter((r) => r.ok).length;
      const failed = data.results.length - ok;
      const msg = `${ok} ${pluralize(ok, "rendu lancé", "rendus lancés")} · ${failed} ${pluralize(failed, "échec", "échecs")}`;
      if (failed > 0) {
        toast.error(msg);
        // Au moins une ligne est partie malgré l'échec des autres — la
        // fermeture doit recharger le calendrier (voir handleModalClose).
        if (ok > 0) launchedAnyRef.current = true;
        setLaunchResults(new Map(data.results.map((r) => [r.slotId, r])));
        // Les lignes réussies n'ont plus rien à relancer — elles se
        // décochent pour qu'un second clic ne cible que les échecs restants.
        setCheckedIds((prev) => {
          const next = new Set(prev);
          for (const r of data.results) if (r.ok) next.delete(r.slotId);
          return next;
        });
      } else {
        toast.success(msg);
        onClose();
        onLaunched?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lancement impossible");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <Modal open={open} onClose={handleModalClose} size="xl" className="flex flex-col max-h-[85vh]" dismissOnBackdrop={false}>
      <Modal.Header onClose={handleModalClose}>Lancer les rendus</Modal.Header>
      <Modal.Body className="overflow-y-auto flex-1 min-h-0">
        {loading ? (
          <SkeletonRows />
        ) : previewError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Aperçu impossible"
            description={previewError}
            cta={{ label: "Réessayer", onClick: () => void loadPreview() }}
          />
        ) : rows.length === 0 ? (
          <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">{summaryLine}</p>
            <EmptyState icon={Clapperboard} title="Rien à lancer" description="Aucune publication de ce lot n'attend un rendu." />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">{summaryLine}</p>
            {dayGroups.map((g) => (
              <div key={g.key}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  {g.label}
                </h3>
                <div className="space-y-1.5">
                  {g.rows.map((row) => (
                    <BulkRenderRow
                      key={row.slotId}
                      row={row}
                      checked={checkedIds.has(row.slotId)}
                      onToggleChecked={(checked) => toggleChecked(row.slotId, checked)}
                      onChangeMedia={(blockId, asset) => handleMediaChange(row.slotId, blockId, asset)}
                      duplicateLabelFor={(blockId, usageKey, assetId) =>
                        duplicateLabelFor(row.slotId, blockId, usageKey, assetId)
                      }
                      launchResult={launchResults.get(row.slotId) ?? null}
                      disabled={launching}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={handleModalClose} disabled={launching}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={Clapperboard}
          onClick={() => void handleLaunch()}
          disabled={checkedIds.size === 0 || launching || loading}
          loading={launching}
        >
          {/* Usage FR : "0 rendu", pas "0 rendus" — singulier pour 0 ET 1,
              contrairement à `pluralize` (utilisé ailleurs dans ce fichier
              pour des décomptes où le pluriel à 0 est l'usage attendu). */}
          {`Lancer ${checkedIds.size} ${checkedIds.size <= 1 ? "rendu" : "rendus"}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
