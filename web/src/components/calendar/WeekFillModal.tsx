"use client";

/**
 * « Remplir la semaine » — répartit les reels auto entre les comptes.
 *
 * Remplace le geste qui coûtait le plus de temps : créer les publications une
 * par une dans AddSlotModal en scrutant le calendrier entre chaque, pour ne pas
 * reposter la même recette trop vite sur des comptes qui partagent l'audience.
 *
 * Le calcul vit dans `lib/calendar/dispatch`, PUR et côté client : recalculer à
 * chaque case échangée ne coûte donc aucun aller-retour serveur. Le serveur ne
 * fournit que la matière (pool + historique) et écrit à la fin.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Alert } from "@/components/ui/Alert";
import { Chip } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { parisDayKey, weekdayDayFr } from "@/lib/date/formatFr";
import { summarizeCalendarSkips, type GenerateCalendarSkip } from "@/lib/calendar/skips";
import {
  cellKey,
  dayIndexFromKey,
  dispatchRecipes,
  minimumAchievableGap,
  rankCandidatesForCell,
  type DispatchCandidate,
  type DispatchCell,
  type RecipeHistory,
} from "@/lib/calendar/dispatch";

/**
 * Les cinq premiers jours de la semaine affichée — le défaut.
 *
 * Des INDEX relatifs à `weekStart`, jamais « lundi = 0 » : le calendrier ne
 * garantit pas que sa semaine commence un lundi (le paramètre d'URL peut la
 * décaler d'un jour), et un libellé figé afficherait « Lun » sur un dimanche.
 * Les noms de jours se dérivent donc de la DATE réelle, plus bas.
 */
const DEFAULT_DAYS = [0, 1, 2, 3, 4];
const STORAGE_KEY = "calendar:week-fill:v1";

/** Une publication que le PLANNING des recettes produirait cette semaine. */
interface PlanningTarget {
  accountId: string;
  patternBindingId: string;
  scheduledAt: string;
  label: string;
  patternTemplateId: string;
  templateId: string | null;
}

interface WeekFillContext {
  accounts: { id: string; name: string; handle: string }[];
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  pool: { patternTemplateId: string; label: string; accountCount: number }[];
  existingUse: Record<string, RecipeHistory>;
  occupiedByAccount: Record<string, string[]>;
}

interface WeekFillModalProps {
  /** Lundi de la semaine affichée. */
  weekStart: Date;
  accounts: { id: string; name: string; handle: string }[];
  /** Compte filtré sur le calendrier — pré-coché s'il y en a un. */
  filteredAccountId?: string;
  onCreated: () => void;
  onClose: () => void;
}

/**
 * « lun. 21 » pour une clé de jour. Midi UTC pour que le jour civil Paris soit
 * le bon quel que soit le décalage horaire.
 */
function dayLabelOf(dayKey: string): string {
  return weekdayDayFr(new Date(`${dayKey}T12:00:00Z`));
}

/** "YYYY-MM-DD" du n-ième jour de la semaine, en heure locale (= Paris ici). */
function dayKeyOf(weekStart: Date, offset: number): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface RememberedPrefs {
  poolTemplateIds?: string[];
  dayOffsets?: number[];
  perDay?: number;
  includePlanning?: boolean;
}

function loadPrefs(): RememberedPrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as RememberedPrefs;
  } catch {
    // localStorage indisponible (navigation privée, stockage bloqué) : on
    // repart des défauts plutôt que de casser l'écran.
    return {};
  }
}

function savePrefs(prefs: RememberedPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* sans conséquence : la sélection repartira des défauts */
  }
}

export function WeekFillModal({
  weekStart,
  accounts,
  filteredAccountId,
  onCreated,
  onClose,
}: WeekFillModalProps) {
  const [context, setContext] = useState<WeekFillContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [accountIds, setAccountIds] = useState<string[]>(() =>
    filteredAccountId ? [filteredAccountId] : accounts.map((a) => a.id),
  );
  const [dayOffsets, setDayOffsets] = useState<number[]>(
    () => loadPrefs().dayOffsets ?? DEFAULT_DAYS,
  );
  const [perDay, setPerDay] = useState(() => loadPrefs().perDay ?? 1);
  const [poolIds, setPoolIds] = useState<string[] | null>(() => loadPrefs().poolTemplateIds ?? null);
  /** Choix manuels : `cellKey` → recette, ou `null` pour une case vidée. */
  const [pinned, setPinned] = useState<Record<string, string | null>>({});

  /**
   * Le planning des recettes — ce que produisait le bouton « Générer ».
   * Absorbé ici plutôt que laissé à côté : les deux familles remplissent la même
   * semaine, les voir dans deux écrans séparés obligeait à faire la somme de
   * tête. Les deux CHEMINS D'ÉCRITURE restent distincts (cf. handleCreate).
   */
  const [includePlanning, setIncludePlanning] = useState(() => loadPrefs().includePlanning ?? true);
  const [planning, setPlanning] = useState<PlanningTarget[]>([]);
  const [planningSkips, setPlanningSkips] = useState<GenerateCalendarSkip[]>([]);
  const [planningNote, setPlanningNote] = useState<string | null>(null);

  // ── Le contexte serveur ───────────────────────────────────────────────────
  const accountKey = accountIds.join(",");
  useEffect(() => {
    if (!accountKey) {
      setContext(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(
      `/api/calendar/week-fill?accountIds=${encodeURIComponent(accountKey)}&weekStart=${weekStart.toISOString()}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error);
        return (await r.json()) as WeekFillContext;
      })
      .then((data) => {
        if (cancelled) return;
        setContext(data);
        // Les choix manuels portent sur un contexte donné : le changement de
        // périmètre les rendrait incohérents.
        setPinned({});
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message || "Chargement impossible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, weekStart]);

  /**
   * Ce que le planning des recettes produirait — via la route de génération
   * EXISTANTE en dry-run, avec son paramètre `accountIds` que personne
   * n'utilisait (le bouton « Générer » ignorait le filtre compte de l'écran).
   */
  useEffect(() => {
    if (!accountKey || !includePlanning) {
      setPlanning([]);
      setPlanningSkips([]);
      setPlanningNote(null);
      return;
    }
    let cancelled = false;
    const dateTo = new Date(weekStart);
    dateTo.setDate(dateTo.getDate() + 6);
    dateTo.setHours(23, 59, 59, 999);

    void fetch("/api/calendar/generate?dry=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountIds: accountKey.split(","),
        dateFrom: weekStart.toISOString(),
        dateTo: dateTo.toISOString(),
      }),
    })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          // Une semaine entièrement passée est refusée par la route : ce n'est
          // pas une panne, on le dit sans crier.
          setPlanning([]);
          setPlanningSkips([]);
          setPlanningNote((data as { error?: string }).error ?? null);
          return;
        }
        const d = data as { preview?: PlanningTarget[]; skips?: GenerateCalendarSkip[] };
        setPlanning(d.preview ?? []);
        setPlanningSkips(d.skips ?? []);
        setPlanningNote(null);
      })
      .catch(() => {
        if (!cancelled) setPlanningNote("Planning indisponible.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, weekStart, includePlanning]);

  // Pool effectif : la sélection mémorisée, restreinte à ce qui existe vraiment.
  const effectivePool = useMemo(() => {
    const available = context?.pool.map((p) => p.patternTemplateId) ?? [];
    if (!poolIds) return available;
    const kept = poolIds.filter((id) => available.includes(id));
    return kept.length > 0 ? kept : available;
  }, [context, poolIds]);

  const candidatesByAccount = useMemo(() => {
    const out: Record<string, DispatchCandidate[]> = {};
    for (const [accountId, list] of Object.entries(context?.candidatesByAccount ?? {})) {
      out[accountId] = list.filter((c) => effectivePool.includes(c.patternTemplateId));
    }
    return out;
  }, [context, effectivePool]);

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => accountIds.includes(a.id)),
    [accounts, accountIds],
  );

  // ── Les cases, et la proposition ──────────────────────────────────────────
  /** Jours par compte où une publication existe déjà OU va naître du planning. */
  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const [accountId, days] of Object.entries(context?.occupiedByAccount ?? {})) {
      for (const dayKey of days) set.add(`${accountId}|${dayKey}`);
    }
    for (const t of planning) {
      set.add(`${t.accountId}|${parisDayKey(t.scheduledAt)}`);
    }
    return set;
  }, [context, planning]);

  /** Ce que le planning pose, indexé par case, pour l'afficher dans la grille. */
  const planningByCell = useMemo(() => {
    const map = new Map<string, PlanningTarget[]>();
    for (const t of planning) {
      const key = `${t.accountId}|${parisDayKey(t.scheduledAt)}`;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return map;
  }, [planning]);

  /**
   * L'historique VU PAR LE TOURNIQUET inclut les publications du planning :
   * sans ça, une RVA4 planifiée le mardi n'empêcherait pas d'en proposer une le
   * lundi — le doublon exact qu'on corrige, par la porte du planning.
   */
  const existingUseWithPlanning = useMemo(() => {
    const base = context?.existingUse ?? {};
    if (planning.length === 0) return base;
    const merged: typeof base = {};
    for (const [key, h] of Object.entries(base)) {
      merged[key] = {
        allDays: [...h.allDays],
        byAccount: Object.fromEntries(
          Object.entries(h.byAccount).map(([a, d]) => [a, [...d]]),
        ),
      };
    }
    for (const t of planning) {
      const contentKey = t.templateId ?? t.patternTemplateId;
      const day = dayIndexFromKey(parisDayKey(t.scheduledAt));
      const h = (merged[contentKey] ??= { allDays: [], byAccount: {} });
      h.allDays.push(day);
      (h.byAccount[t.accountId] ??= []).push(day);
    }
    return merged;
  }, [context, planning]);

  const cells = useMemo<DispatchCell[]>(() => {
    const out: DispatchCell[] = [];
    for (const offset of [...dayOffsets].sort((a, b) => a - b)) {
      const dayKey = dayKeyOf(weekStart, offset);
      for (const account of selectedAccounts) {
        // Une journée déjà occupée sur ce compte n'est jamais réécrite.
        if (occupied.has(`${account.id}|${dayKey}`)) continue;
        for (let rank = 0; rank < perDay; rank++) {
          out.push({ accountId: account.id, dayKey, rank });
        }
      }
    }
    return out;
  }, [dayOffsets, weekStart, selectedAccounts, perDay, occupied]);

  const proposal = useMemo(
    () =>
      dispatchRecipes({
        cells,
        candidatesByAccount,
        existingUse: existingUseWithPlanning,
        pinned,
      }),
    [cells, candidatesByAccount, existingUseWithPlanning, pinned],
  );

  const byCell = useMemo(
    () => new Map(proposal.assignments.map((a) => [cellKey(a.cell), a])),
    [proposal],
  );

  /**
   * La borne se calcule sur les CONTENUS distincts, pas sur les recettes : deux
   * recettes rendues depuis le même template builder ne comptent que pour une,
   * et annoncer 4 là où il n'y a que 3 contenus rendrait le chiffre faux —
   * c'est-à-dire inutile.
   */
  const distinctContents = useMemo(() => {
    const keys = new Set<string>();
    for (const list of Object.values(candidatesByAccount)) {
      for (const c of list) keys.add(c.contentKey);
    }
    return keys.size;
  }, [candidatesByAccount]);

  const minGap = minimumAchievableGap(distinctContents, selectedAccounts.length * perDay);
  const totalToCreate =
    proposal.assignments.length + (includePlanning ? planning.length : 0);

  // ── Création ──────────────────────────────────────────────────────────────
  /**
   * Deux chemins d'écriture, VOLONTAIREMENT distincts.
   *
   * `generateCalendarSlots` écrit par `createMany` — sans légende pré-remplie,
   * sans tirage de fiche de données, avec `isAuto: true` ; `createSlot` fait
   * l'inverse sur les trois points. Les fusionner ferait consommer des fiches
   * de bibliothèque à des publications qui n'en consommaient pas : ce serait une
   * décision produit déguisée en refactor. Une seule confirmation, deux chemins
   * inchangés — le planning d'abord, puisqu'il a sa propre idempotence.
   */
  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      let plannedCreated = 0;
      if (includePlanning && planning.length > 0) {
        const dateTo = new Date(weekStart);
        dateTo.setDate(dateTo.getDate() + 6);
        dateTo.setHours(23, 59, 59, 999);
        const genRes = await fetch("/api/calendar/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountIds: accountIds,
            dateFrom: weekStart.toISOString(),
            dateTo: dateTo.toISOString(),
          }),
        });
        const genData = (await genRes.json().catch(() => ({}))) as {
          error?: string;
          created?: number;
        };
        if (!genRes.ok) {
          toast.error(genData.error ?? "Génération du planning impossible.");
          return;
        }
        plannedCreated = genData.created ?? 0;
      }

      if (proposal.assignments.length === 0) {
        toast.success(
          `${plannedCreated} publication${plannedCreated > 1 ? "s" : ""} créée${plannedCreated > 1 ? "s" : ""} depuis le planning.`,
        );
        savePrefs({ poolTemplateIds: effectivePool, dayOffsets, perDay, includePlanning });
        onCreated();
        onClose();
        return;
      }

      const res = await fetch("/api/calendar/week-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: proposal.assignments.map((a) => ({
            accountId: a.cell.accountId,
            patternBindingId: a.candidate.patternBindingId,
            dayKey: a.cell.dayKey,
            time: a.candidate.publishTime,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: unknown[];
        failed?: { label: string; dayKey: string; error: string }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Création impossible.");
        return;
      }
      const created = (data.ok?.length ?? 0) + plannedCreated;
      if (data.failed?.length) {
        toast.error(
          `${created} créée(s), ${data.failed.length} refusée(s) : ${data.failed
            .map((f) => `${f.label} le ${f.dayKey} (${f.error})`)
            .join(" · ")}`,
        );
      } else {
        toast.success(
          `${created} publication${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}${
            plannedCreated > 0 ? ` (dont ${plannedCreated} du planning)` : ""
          }.`,
        );
      }
      savePrefs({ poolTemplateIds: effectivePool, dayOffsets, perDay, includePlanning });
      onCreated();
      onClose();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setCreating(false);
    }
  }, [
    proposal,
    effectivePool,
    dayOffsets,
    perDay,
    includePlanning,
    planning,
    weekStart,
    accountIds,
    onCreated,
    onClose,
  ]);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <Modal open onClose={onClose} size="full">
      <div className="flex flex-col max-h-[calc(100vh-2rem)]">
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-[16px] font-semibold text-foreground">Remplir la semaine</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Chaque case reçoit la recette servie il y a le plus longtemps, tous comptes confondus.
            {minGap !== null && (
              <>
                {" "}
                <span className="text-foreground">
                  {distinctContents} contenu{distinctContents > 1 ? "s" : ""} distinct
                  {distinctContents > 1 ? "s" : ""} ·{" "}
                  {selectedAccounts.length * perDay} publication
                  {selectedAccounts.length * perDay > 1 ? "s" : ""}/jour → écart minimum
                  atteignable : {minGap} j
                </span>
              </>
            )}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── Périmètre ─────────────────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-3">
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Comptes
              </h3>
              <div className="space-y-1">
                {accounts.map((a) => (
                  // `Checkbox.label` est sr-only : le texte visible se met à
                  // côté, comme partout ailleurs dans le repo.
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={accountIds.includes(a.id)}
                      onChange={() => setAccountIds((prev) => toggle(prev, a.id))}
                      size="sm"
                      label={`${a.name} (@${a.handle})`}
                    />
                    <span className="text-[12px] text-foreground truncate">@{a.handle}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Jours
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 7 }, (_, offset) => offset).map((offset) => (
                  <button
                    key={offset}
                    type="button"
                    onClick={() =>
                      setDayOffsets((prev) =>
                        prev.includes(offset)
                          ? prev.filter((d) => d !== offset)
                          : [...prev, offset],
                      )
                    }
                    className={[
                      "px-2.5 py-1 rounded-md text-[12px] border transition-colors",
                      dayOffsets.includes(offset)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent",
                    ].join(" ")}
                  >
                    {dayLabelOf(dayKeyOf(weekStart, offset))}
                  </button>
                ))}
              </div>
              <div className="mt-3 w-40">
                <span className="block text-[11px] text-muted-foreground mb-1">
                  Par compte et par jour
                </span>
                <NumberStepper value={perDay} onChange={setPerDay} min={1} max={4} />
              </div>
              {/* Ce que produisait le bouton « Générer ». */}
              <label className="mt-3 flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={includePlanning}
                  onChange={setIncludePlanning}
                  size="sm"
                  label="Inclure les publications planifiées par les recettes"
                />
                <span className="text-[12px] text-foreground leading-tight">
                  Inclure le planning des recettes
                  {planning.length > 0 && (
                    <span className="text-muted-foreground"> · {planning.length}</span>
                  )}
                </span>
              </label>
            </section>

            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Recettes dans lesquelles piocher
              </h3>
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {(context?.pool ?? []).map((p) => (
                  <label
                    key={p.patternTemplateId}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={effectivePool.includes(p.patternTemplateId)}
                      onChange={() =>
                        setPoolIds((prev) => toggle(prev ?? effectivePool, p.patternTemplateId))
                      }
                      size="sm"
                      label={p.label}
                    />
                    <span className="text-[12px] text-foreground truncate">
                      {p.label}
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.accountCount} compte{p.accountCount > 1 ? "s" : ""}
                      </span>
                    </span>
                  </label>
                ))}
                {!loading && (context?.pool.length ?? 0) === 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    Aucune recette auto activée sur ces comptes.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* ── La grille ─────────────────────────────────────────────────── */}
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Chargement…</p>
          ) : (
            <WeekFillGrid
              weekStart={weekStart}
              dayOffsets={[...dayOffsets].sort((a, b) => a - b)}
              accounts={selectedAccounts}
              perDay={perDay}
              occupied={occupied}
              planningByCell={planningByCell}
              byCell={byCell}
              candidatesByAccount={candidatesByAccount}
              existingUse={existingUseWithPlanning}
              onPin={(key, templateId) =>
                setPinned((prev) => ({ ...prev, [key]: templateId }))
              }
            />
          )}

          {planningNote && <Alert variant="info">{planningNote}</Alert>}

          {/* Les refus du planning — ce que l'ancienne modale de « Générer »
              affichait, et qui aurait disparu avec le bouton.

              SAUF « recette active sans jour planifié » : dans l'ancien écran
              c'était un défaut de paramétrage à corriger ; ici ce sont
              précisément les recettes que le tourniquet répartit. Le conseil
              « renseignez le planning de la recette » serait devenu faux. */}
          {includePlanning &&
            summarizeCalendarSkips(
              planningSkips.filter((s) => s.reason !== "empty_day_of_week"),
            ).map((line) => (
              <Alert key={line.reason} variant="warning">
                {line.text}
                {line.details.length > 0 && (
                  <span className="block mt-0.5 text-[11.5px] opacity-80">
                    {line.details.join(" · ")}
                  </span>
                )}
              </Alert>
            ))}

          {proposal.unfilled.some((u) => u.reason === "pool_exhausted_day") && (
            <Alert variant="warning">
              Certaines cases restent vides : toutes les recettes du pool sont déjà posées ce
              jour-là. Cochez plus de recettes, ou publiez moins souvent.
            </Alert>
          )}

          {/* `createSlot` consomme une fiche de bibliothèque de données par
              publication, et supprimer la publication ne la rend pas. */}
          {proposal.assignments.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              Ajustez l&apos;aperçu avant de créer : une publication supprimée après coup ne rend
              pas la fiche de données qu&apos;elle a consommée.
            </p>
          )}
        </div>

        <footer className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <span className="text-[12px] text-muted-foreground">
            {totalToCreate} publication{totalToCreate > 1 ? "s" : ""} à créer
            {planning.length > 0 && includePlanning && ` (dont ${planning.length} du planning)`}
            {proposal.unfilled.length > 0 && ` · ${proposal.unfilled.length} case(s) vide(s)`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              loading={creating}
              disabled={totalToCreate === 0}
            >
              Créer les {totalToCreate}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/** La grille comptes × jours. Séparée : c'est la moitié du fichier. */
function WeekFillGrid({
  weekStart,
  dayOffsets,
  accounts,
  perDay,
  occupied,
  planningByCell,
  byCell,
  candidatesByAccount,
  existingUse,
  onPin,
}: {
  weekStart: Date;
  dayOffsets: number[];
  accounts: { id: string; name: string; handle: string }[];
  perDay: number;
  occupied: Set<string>;
  planningByCell: Map<string, PlanningTarget[]>;
  byCell: Map<string, ReturnType<typeof dispatchRecipes>["assignments"][number]>;
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  existingUse: Record<string, RecipeHistory>;
  onPin: (key: string, templateId: string | null) => void;
}) {
  if (accounts.length === 0 || dayOffsets.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Choisissez au moins un compte et un jour.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card z-10 text-left font-medium text-muted-foreground p-2 w-40">
              Compte
            </th>
            {dayOffsets.map((offset) => (
              <th
                key={offset}
                className="text-left font-medium text-muted-foreground p-2 min-w-[11rem]"
              >
                {dayLabelOf(dayKeyOf(weekStart, offset))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-t border-border align-top">
              <td className="sticky left-0 bg-card z-10 p-2 text-foreground truncate">
                @{account.handle}
              </td>
              {dayOffsets.map((offset) => {
                const dayKey = dayKeyOf(weekStart, offset);
                const planned = planningByCell.get(`${account.id}|${dayKey}`);
                if (planned?.length) {
                  // Posée par le planning de la recette : non modifiable ici,
                  // ça se règle sur la recette du compte.
                  return (
                    <td key={offset} className="p-2 space-y-1">
                      {planned.map((t) => (
                        <div key={t.patternBindingId} className="flex items-center gap-1.5">
                          <span className="text-[12px] text-foreground truncate">{t.label}</span>
                          <Chip size="sm" variant="default">
                            planning
                          </Chip>
                        </div>
                      ))}
                    </td>
                  );
                }
                if (occupied.has(`${account.id}|${dayKey}`)) {
                  return (
                    <td key={offset} className="p-2">
                      <span className="text-muted-foreground/70 text-[11.5px]">
                        déjà programmé
                      </span>
                    </td>
                  );
                }
                return (
                  <td key={offset} className="p-2 space-y-1.5">
                    {Array.from({ length: perDay }, (_, rank) => {
                      const cell = { accountId: account.id, dayKey, rank };
                      const key = cellKey(cell);
                      const assignment = byCell.get(key);
                      const options = rankCandidatesForCell(
                        cell,
                        candidatesByAccount[account.id] ?? [],
                        existingUse,
                      );
                      return (
                        <div key={rank}>
                          <Select
                            value={assignment?.candidate.patternTemplateId ?? ""}
                            onChange={(v) => onPin(key, v || null)}
                            options={[
                              {
                                value: "",
                                // Dire POURQUOI la case est vide : « aucune
                                // recette auto activée sur ce compte » n'est
                                // pas la même chose que « je l'ai vidée ».
                                label:
                                  (candidatesByAccount[account.id] ?? []).length === 0
                                    ? "aucune recette sur ce compte"
                                    : options.length === 0
                                      ? "toutes déjà posées ce jour"
                                      : "— vide —",
                              },
                              ...options.map((o) => ({
                                value: o.candidate.patternTemplateId,
                                label:
                                  o.rawGap === null
                                    ? `${o.candidate.label} · jamais`
                                    : `${o.candidate.label} · ${o.rawGap} j`,
                              })),
                            ]}
                            disabled={options.length === 0 && !assignment}
                          />
                          {assignment && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">
                                {assignment.candidate.publishTime}
                              </span>
                              <Chip size="sm" variant={assignment.pinned ? "sky" : "default"}>
                                {assignment.gapDays === null
                                  ? "jamais servie"
                                  : `il y a ${assignment.gapDays} j`}
                              </Chip>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
