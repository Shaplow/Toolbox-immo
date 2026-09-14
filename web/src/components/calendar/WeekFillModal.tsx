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
import { RotateCcw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Alert } from "@/components/ui/Alert";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Chip } from "@/components/ui/Chip";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { toast } from "@/components/ui/Toast";
import { parisDayKey, weekdayDayFr, weekdayInitialFr } from "@/lib/date/formatFr";
import { compareNatural } from "@/lib/utils/naturalSort";
import { summarizeCalendarSkips, type GenerateCalendarSkip } from "@/lib/calendar/skips";
import { isDayActive, publicationsByDay, type DayMask } from "@/lib/calendar/dayMask";
import {
  busiestDayCapacity,
  cellKey,
  dayIndexFromKey,
  dispatchRecipes,
  minimumAchievableGap,
  type DispatchCandidate,
  type DispatchCell,
  type DispatchOption,
} from "@/lib/calendar/dispatch";
// Type SEUL (effacé à la compilation) : la forme du contexte était redéclarée à
// la main ici, et une divergence avec le service n'aurait rien cassé à la
// compilation — juste affiché des champs vides.
import type { WeekFillContext } from "@/lib/services/calendar/weekFillService";

/**
 * Les cinq premiers jours de la semaine affichée — le défaut.
 *
 * Des INDEX relatifs à `weekStart`, jamais « lundi = 0 » : le calendrier ne
 * garantit pas que sa semaine commence un lundi (le paramètre d'URL peut la
 * décaler d'un jour), et un libellé figé afficherait « Lun » sur un dimanche.
 * Les noms de jours se dérivent donc de la DATE réelle, plus bas.
 */
const DEFAULT_DAYS = [0, 1, 2, 3, 4];
/** Les sept positions de la matrice comptes × jours — fixes, pour comparer en colonne. */
const WEEK_OFFSETS = [0, 1, 2, 3, 4, 5, 6];
/**
 * v2 : la v1 mémorisait des IDS de recettes. Toute recette créée ensuite était
 * donc exclue du pool POUR TOUJOURS, sans le moindre signal. On mémorise
 * désormais des FAMILLES (stables) et une liste d'EXCLUSIONS (une recette
 * nouvelle est incluse par défaut) — la classe de bug disparaît avec la clé.
 */
const STORAGE_KEY = "calendar:week-fill:v2";

/** « Sans famille » est une entrée de plein droit, pas une absence. */
const NO_FAMILY = "__none__";
const familyKeyOf = (family: string | null) => family ?? NO_FAMILY;
const familyLabelOf = (family: string | null) => family ?? "Sans famille";

/** Une publication que le PLANNING des recettes produirait cette semaine. */
interface PlanningTarget {
  accountId: string;
  patternBindingId: string;
  scheduledAt: string;
  label: string;
  patternTemplateId: string;
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

/** « L », « M »… pour la matrice comptes × jours. */
function dayInitialOf(dayKey: string): string {
  return weekdayInitialFr(new Date(`${dayKey}T12:00:00Z`));
}

/** "YYYY-MM-DD" du n-ième jour de la semaine, en heure locale (= Paris ici). */
function dayKeyOf(weekStart: Date, offset: number): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface RememberedPrefs {
  /** Clés de famille retenues (`__none__` comprise). */
  families?: string[];
  /** Recettes explicitement écartées à l'intérieur des familles retenues. */
  excludedTemplateIds?: string[];
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
  /** `null` = jamais choisi → toutes les familles, c'est-à-dire le comportement d'avant. */
  const [selectedFamilies, setSelectedFamilies] = useState<string[] | null>(
    () => loadPrefs().families ?? null,
  );
  const [excludedIds, setExcludedIds] = useState<string[]>(
    () => loadPrefs().excludedTemplateIds ?? [],
  );
  /** Choix manuels : `cellKey` → recette, ou `null` pour une case vidée. */
  const [pinned, setPinned] = useState<Record<string, string | null>>({});

  /**
   * Jours éteints, par compte : `accountId` → offsets relatifs à `weekStart`.
   *
   * « Parfois j'ai des comptes qui n'ont pas de contenu certains jours » : le
   * périmètre n'est pas un produit cartésien comptes × jours, il a des trous.
   *
   * Volontairement NON mémorisé (absent de `RememberedPrefs`) : « alban n'a pas
   * de contenu mardi » est vrai CETTE semaine-là, pas en général. Un masque
   * persistant se ferait oublier et retirerait des publications sans que rien ne
   * l'explique. La modale étant démontée à la fermeture, la semaine se rouvre
   * entière.
   */
  const [offDaysByAccount, setOffDaysByAccount] = useState<DayMask>({});
  const isDayOn = useCallback(
    (accountId: string, offset: number) => isDayActive(offDaysByAccount, accountId, offset),
    [offDaysByAccount],
  );
  /** Total éteint, affiché en titre de section : sinon le masque s'oublie au scroll. */
  const offCount = useMemo(
    () => Object.values(offDaysByAccount).reduce((n, d) => n + d.length, 0),
    [offDaysByAccount],
  );

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

  /** Les familles présentes dans le pool, avec leur nombre de recettes. */
  const families = useMemo(() => {
    const map = new Map<string, { key: string; family: string | null; count: number }>();
    for (const p of context?.pool ?? []) {
      const key = familyKeyOf(p.family);
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { key, family: p.family, count: 1 });
    }
    // « Sans famille » en dernier : c'est un reste à ranger, pas une famille.
    return [...map.values()].sort((a, b) =>
      a.family === null ? 1 : b.family === null ? -1 : compareNatural(a.family, b.family),
    );
  }, [context]);

  /** Familles retenues, restreintes à ce qui existe vraiment sur ce périmètre. */
  const effectiveFamilies = useMemo(() => {
    const available = families.map((f) => f.key);
    if (!selectedFamilies) return available;
    const kept = selectedFamilies.filter((k) => available.includes(k));
    return kept.length > 0 ? kept : available;
  }, [families, selectedFamilies]);

  // Pool effectif : les familles retenues, moins les recettes écartées à la main.
  const effectivePool = useMemo(
    () =>
      (context?.pool ?? [])
        .filter((p) => effectiveFamilies.includes(familyKeyOf(p.family)))
        .filter((p) => !excludedIds.includes(p.patternTemplateId))
        .map((p) => p.patternTemplateId),
    [context, effectiveFamilies, excludedIds],
  );

  /** Les recettes proposables au choix « affiner » — celles des familles retenues. */
  const poolInFamilies = useMemo(
    () =>
      (context?.pool ?? []).filter((p) => effectiveFamilies.includes(familyKeyOf(p.family))),
    [context, effectiveFamilies],
  );

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

  /**
   * Un compte sans aucune recette des familles retenues ne peut rien recevoir.
   * Il n'est PAS masqué pour autant : il est replié sous la grille avec les
   * familles que ses liaisons couvrent — une liaison mal placée doit se voir,
   * le filtre famille ne la corrige pas.
   */
  const servableAccounts = useMemo(
    () => selectedAccounts.filter((a) => (candidatesByAccount[a.id] ?? []).length > 0),
    [selectedAccounts, candidatesByAccount],
  );
  const unservableAccounts = useMemo(
    () => selectedAccounts.filter((a) => (candidatesByAccount[a.id] ?? []).length === 0),
    [selectedAccounts, candidatesByAccount],
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
      // La RECETTE, jamais le gabarit : cet index doit coïncider avec celui de
      // `existingUse` construit par le service, sinon les publications du
      // planning deviennent invisibles au tourniquet.
      const day = dayIndexFromKey(parisDayKey(t.scheduledAt));
      const h = (merged[t.patternTemplateId] ??= { allDays: [], byAccount: {} });
      h.allDays.push(day);
      (h.byAccount[t.accountId] ??= []).push(day);
    }
    return merged;
  }, [context, planning]);

  const cells = useMemo<DispatchCell[]>(() => {
    const out: DispatchCell[] = [];
    for (const offset of [...dayOffsets].sort((a, b) => a - b)) {
      const dayKey = dayKeyOf(weekStart, offset);
      for (const account of servableAccounts) {
        // Éteint à la main pour ce compte : pas de contenu ce jour-là.
        if (!isDayOn(account.id, offset)) continue;
        // Une journée déjà occupée sur ce compte n'est jamais réécrite.
        if (occupied.has(`${account.id}|${dayKey}`)) continue;
        for (let rank = 0; rank < perDay; rank++) {
          out.push({ accountId: account.id, dayKey, rank });
        }
      }
    }
    return out;
  }, [dayOffsets, weekStart, servableAccounts, perDay, occupied, isDayOn]);

  const proposal = useMemo(
    () =>
      dispatchRecipes({
        cells,
        candidatesByAccount,
        existingUse: existingUseWithPlanning,
        pinned,
        // L'ordre d'affichage EST l'ordre de service : la ligne du haut reçoit
        // la recette la plus anciennement publiée. Sans ça c'est l'identifiant
        // technique du compte qui tranchait, donc son ordre de création.
        accountPriority: servableAccounts.map((a) => a.id),
      }),
    [cells, candidatesByAccount, existingUseWithPlanning, pinned, servableAccounts],
  );

  const byCell = useMemo(
    () => new Map(proposal.assignments.map((a) => [cellKey(a.cell), a])),
    [proposal],
  );

  /** Couples (compte, jour) éteints — la grille doit le DIRE, pas afficher un vide. */
  const offCells = useMemo(() => {
    const set = new Set<string>();
    for (const offset of dayOffsets) {
      const dayKey = dayKeyOf(weekStart, offset);
      for (const account of selectedAccounts) {
        if (!isDayOn(account.id, offset)) set.add(`${account.id}|${dayKey}`);
      }
    }
    return set;
  }, [dayOffsets, weekStart, selectedAccounts, isDayOn]);

  /** Recettes réellement proposables sur le périmètre choisi. */
  const distinctContents = useMemo(() => {
    const keys = new Set<string>();
    for (const list of Object.values(candidatesByAccount)) {
      for (const c of list) keys.add(c.patternTemplateId);
    }
    return keys.size;
  }, [candidatesByAccount]);

  /**
   * La charge de chaque jour retenu — plus un simple « nombre de comptes ×
   * perDay » dès qu'un compte est éteint un jour donné.
   */
  const loadByDay = useMemo(
    () =>
      publicationsByDay(
        dayOffsets,
        servableAccounts.map((a) => a.id),
        offDaysByAccount,
        perDay,
      ),
    [dayOffsets, servableAccounts, offDaysByAccount, perDay],
  );
  const busiestLoad = busiestDayCapacity(loadByDay);
  /** Les jours ne portent pas tous la même charge : le dire, sinon le chiffre ment. */
  const unevenLoad = loadByDay.length > 0 && Math.min(...loadByDay) !== busiestLoad;
  const minGap = minimumAchievableGap(distinctContents, busiestLoad);

  /**
   * La borne physique, PAR FAMILLE — la mélanger n'a aucun sens : 13 recettes
   * TRANSACTION pour 13 comptes donnent 1 jour d'écart, 6 recettes COMMERCE
   * pour 1 compte en donnent 6. Un seul chiffre global mentirait aux deux.
   */
  const familyStats = useMemo(
    () =>
      effectiveFamilies.map((key) => {
        const entry = families.find((f) => f.key === key);
        const recipes = (context?.pool ?? []).filter(
          (p) => familyKeyOf(p.family) === key && effectivePool.includes(p.patternTemplateId),
        ).length;
        // Même correction que la borne globale : on compte par JOUR, puis on
        // retient le plus chargé — un compte éteint mardi ne consomme rien mardi.
        const covering = servableAccounts.filter((a) =>
          (context?.familiesByAccount[a.id] ?? []).some((f) => familyKeyOf(f) === key),
        );
        const perDayTotal = busiestDayCapacity(
          publicationsByDay(
            dayOffsets,
            covering.map((a) => a.id),
            offDaysByAccount,
            perDay,
          ),
        );
        return {
          key,
          label: entry ? familyLabelOf(entry.family) : key,
          recipes,
          perDayTotal,
          gap: minimumAchievableGap(recipes, perDayTotal),
        };
      }),
    [
      effectiveFamilies,
      families,
      context,
      effectivePool,
      servableAccounts,
      perDay,
      dayOffsets,
      offDaysByAccount,
    ],
  );
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
        savePrefs({
          families: effectiveFamilies,
          excludedTemplateIds: excludedIds,
          dayOffsets,
          perDay,
          includePlanning,
        });
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
      savePrefs({
          families: effectiveFamilies,
          excludedTemplateIds: excludedIds,
          dayOffsets,
          perDay,
          includePlanning,
        });
      onCreated();
      onClose();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setCreating(false);
    }
  }, [
    proposal,
    effectiveFamilies,
    excludedIds,
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
  const toggleNumber = (list: number[], value: number) =>
    list.includes(value)
      ? list.filter((x) => x !== value)
      : [...list, value].sort((a, b) => a - b);

  return (
    <Modal open onClose={onClose} size="full">
      <div className="flex flex-col max-h-[calc(100vh-2rem)]">
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-[16px] font-semibold text-foreground">Remplir la semaine</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Chaque case reçoit la recette servie il y a le plus longtemps, tous comptes confondus.
            {minGap !== null && familyStats.length <= 1 && (
              <>
                {" "}
                <span className="text-foreground">
                  {distinctContents} recette{distinctContents > 1 ? "s" : ""} ·{" "}
                  {busiestLoad} publication{busiestLoad > 1 ? "s" : ""}
                  {unevenLoad ? " le jour le plus chargé" : "/jour"} → écart minimum
                  atteignable : {minGap} j
                </span>
              </>
            )}
          </p>
          {/* Une borne par famille : mélangées, les deux chiffres seraient faux
              pour chacune. Et à dire franchement — l'écart plafonne à ⌊N/c⌋,
              l'algorithme n'y peut rien, seul le nombre de recettes le bouge. */}
          {familyStats.length > 1 && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
              {familyStats.map((f) => (
                <span key={f.key}>
                  <span className="text-foreground">{f.label}</span> · {f.recipes} recette
                  {f.recipes > 1 ? "s" : ""} / {f.perDayTotal} par jour
                  {unevenLoad ? " au plus" : ""}
                  {f.gap !== null && f.perDayTotal > 0 ? ` → ${f.gap} j` : ""}
                </span>
              ))}
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── Périmètre ─────────────────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-3">
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Comptes
                {offCount > 0 && (
                  <span className="normal-case tracking-normal">
                    {" "}
                    · {offCount} jour{offCount > 1 ? "s" : ""} éteint
                    {offCount > 1 ? "s" : ""}
                  </span>
                )}
              </h3>
              {/* Une matrice comptes × jours : « je laisse activé cyrille, alban…
                  mais je désactive alban le mardi, jeudi et vendredi ». Sept
                  positions FIXES pour que l'œil compare les comptes en colonne. */}
              <div className="space-y-1">
                {accounts.map((a) => {
                  const kept = accountIds.includes(a.id);
                  const offDays = offDaysByAccount[a.id] ?? [];
                  return (
                    <div key={a.id} className="flex items-center gap-2">
                      {/* `Checkbox.label` est sr-only : le texte visible se met à
                          côté, comme partout ailleurs dans le repo. */}
                      <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                        <Checkbox
                          checked={kept}
                          onChange={() => setAccountIds((prev) => toggle(prev, a.id))}
                          size="sm"
                          label={`${a.name} (@${a.handle})`}
                        />
                        <span
                          className={`text-[12px] truncate ${
                            kept && offDays.length >= dayOffsets.length
                              ? "text-muted-foreground"
                              : "text-foreground"
                          }`}
                        >
                          @{a.handle}
                        </span>
                      </label>
                      {/* Rendu même quand le compte est décoché : les sept
                          positions doivent rester alignées d'une ligne à l'autre,
                          c'est tout l'intérêt d'une matrice. */}
                      <div
                        role="group"
                        aria-label={`Jours de publication de @${a.handle}`}
                        className={[
                          "flex items-center gap-px shrink-0",
                          kept ? "" : "opacity-40 pointer-events-none",
                        ].join(" ")}
                      >
                        {WEEK_OFFSETS.map((offset) => {
                          const dayKey = dayKeyOf(weekStart, offset);
                          if (!dayOffsets.includes(offset)) {
                            // Jour écarté pour TOUT LE MONDE au-dessus : la
                            // position reste, mais il n'y a rien à décider ici.
                            // `aria-hidden` : sept points lus à voix haute sur
                            // chaque ligne n'apprennent rien à personne.
                            return (
                              <span
                                key={offset}
                                aria-hidden="true"
                                title={`${dayLabelOf(dayKey)} n'est pas retenu cette semaine`}
                                className="h-5 w-5 inline-flex items-center justify-center text-[10px] text-muted-foreground/30"
                              >
                                ·
                              </span>
                            );
                          }
                          const on = isDayOn(a.id, offset);
                          return (
                            <button
                              key={offset}
                              type="button"
                              aria-pressed={on}
                              // Le contenu est « M » : sans ça, un lecteur d'écran
                              // annonce deux « M » identiques dans la semaine.
                              aria-label={dayLabelOf(dayKey)}
                              title={
                                on
                                  ? `@${a.handle} publie ${dayLabelOf(dayKey)} — cliquer pour éteindre`
                                  : `@${a.handle} ne publie pas ${dayLabelOf(dayKey)} — cliquer pour rallumer`
                              }
                              onClick={() =>
                                setOffDaysByAccount((prev) => ({
                                  ...prev,
                                  [a.id]: toggleNumber(prev[a.id] ?? [], offset),
                                }))
                              }
                              // Gris PLEIN = éteint, ici comme dans la grille : un
                              // même sens, un même vocabulaire. Une barre sur une
                              // capitale de 10px ne se lit pas, et l'état par
                              // défaut (tout allumé) reste une ligne calme.
                              className={[
                                "h-5 w-5 rounded-sm text-[10px] leading-none transition-colors hover:bg-accent",
                                on
                                  ? "text-foreground"
                                  : "bg-muted text-muted-foreground/70",
                              ].join(" ")}
                            >
                              {dayInitialOf(dayKey)}
                            </button>
                          );
                        })}
                        {/* Fente FIXE : sans elle, la ligne qui porte le bouton
                            décale ses sept lettres et la colonne ne s'aligne plus
                            — sur la seule ligne qui compte, justement. */}
                        <span className="w-5 shrink-0 inline-flex justify-center">
                          {offDays.length > 0 && (
                            <ButtonIcon
                              icon={RotateCcw}
                              label={`Rallumer tous les jours de @${a.handle}`}
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                setOffDaysByAccount((prev) => {
                                  const next = { ...prev };
                                  // Pas d'entrée vide : `{}` doit rester « aucun masque ».
                                  delete next[a.id];
                                  return next;
                                })
                              }
                            />
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                Familles
              </h3>
              {/* Vingt cases à cocher, c'était « chiant de tout cocher/décocher ».
                  Une famille se choisit d'un clic et se retient d'une session à
                  l'autre — et elle survit à la création d'une recette, ce qu'une
                  liste d'ids ne faisait pas. */}
              <div className="flex flex-wrap gap-1.5">
                {families.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() =>
                      setSelectedFamilies((prev) => toggle(prev ?? effectiveFamilies, f.key))
                    }
                    className={[
                      "px-2.5 py-1 rounded-md text-[12px] border transition-colors",
                      effectiveFamilies.includes(f.key)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent",
                    ].join(" ")}
                  >
                    {familyLabelOf(f.family)}
                    <span className="opacity-70"> · {f.count}</span>
                  </button>
                ))}
                {!loading && families.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    Aucune recette auto activée sur ces comptes.
                  </p>
                )}
              </div>
              {families.length > 0 && (
                <div className="mt-2">
                  <CollapsibleSection
                    title={`Affiner les recettes · ${effectivePool.length}/${poolInFamilies.length}`}
                    defaultOpen={false}
                    storageKey="calendar:week-fill:refine"
                  >
                    {/* La trappe de sortie : exclure UNE recette ponctuellement,
                        sans renoncer au filtre famille. Ce sont des exclusions,
                        pas une liste blanche — une recette créée demain reste
                        incluse d'office. */}
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {poolInFamilies.map((p) => (
                        <label
                          key={p.patternTemplateId}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Checkbox
                            checked={!excludedIds.includes(p.patternTemplateId)}
                            onChange={() =>
                              setExcludedIds((prev) => toggle(prev, p.patternTemplateId))
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
                    </div>
                  </CollapsibleSection>
                </div>
              )}
            </section>
          </div>

          {/* ── La grille ─────────────────────────────────────────────────── */}
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Chargement…</p>
          ) : (
            <WeekFillGrid
              weekStart={weekStart}
              dayOffsets={[...dayOffsets].sort((a, b) => a - b)}
              accounts={servableAccounts}
              unservableAccounts={unservableAccounts}
              familiesByAccount={context?.familiesByAccount ?? {}}
              perDay={perDay}
              occupied={occupied}
              offCells={offCells}
              planningByCell={planningByCell}
              byCell={byCell}
              optionsByCell={proposal.optionsByCell}
              onPin={(key, templateId) =>
                setPinned((prev) => ({ ...prev, [key]: templateId }))
              }
            />
          )}

          {planningNote && <Alert variant="info">{planningNote}</Alert>}

          {/* Deux recettes du même nom ne sont plus fusionnées en silence : on
              le dit, à lui de fusionner ou d'archiver. */}
          {(context?.duplicateLabels.length ?? 0) > 0 && (
            <Alert variant="warning">
              {context!.duplicateLabels.length === 1
                ? `Deux recettes portent le nom « ${context!.duplicateLabels[0]} »`
                : `Plusieurs recettes portent le même nom : ${context!.duplicateLabels.join(", ")}`}
              {" "}— elles tournent séparément, et peuvent donc sortir le même jour sur deux
              comptes. Archivez-en une s&apos;il s&apos;agit d&apos;un doublon.
            </Alert>
          )}

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
  unservableAccounts,
  familiesByAccount,
  perDay,
  occupied,
  offCells,
  planningByCell,
  byCell,
  optionsByCell,
  onPin,
}: {
  weekStart: Date;
  dayOffsets: number[];
  accounts: { id: string; name: string; handle: string }[];
  /** Comptes sans aucune recette des familles retenues — repliés sous la grille. */
  unservableAccounts: { id: string; name: string; handle: string }[];
  familiesByAccount: Record<string, (string | null)[]>;
  perDay: number;
  occupied: Set<string>;
  /** Couples « accountId|dayKey » éteints à la main dans la liste des comptes. */
  offCells: Set<string>;
  planningByCell: Map<string, PlanningTarget[]>;
  byCell: Map<string, ReturnType<typeof dispatchRecipes>["assignments"][number]>;
  /** Alternatives par case, telles que l'attribution les a vues (cf. dispatchRecipes). */
  optionsByCell: Record<string, DispatchOption[]>;
  onPin: (key: string, templateId: string | null) => void;
}) {
  /** « TRANSACTION · COMMERCE » sous le handle — d'où vient (ou pas) sa matière. */
  const familiesLine = (accountId: string) =>
    (familiesByAccount[accountId] ?? []).map(familyLabelOf).join(" · ");

  if (accounts.length === 0 || dayOffsets.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">
          {dayOffsets.length === 0
            ? "Choisissez au moins un jour."
            : "Aucun compte ne porte de recette dans les familles retenues."}
        </p>
        <UnservableAccountsNote accounts={unservableAccounts} familiesLine={familiesLine} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card z-10 text-left font-medium text-muted-foreground p-1.5 w-36">
                Compte
              </th>
              {dayOffsets.map((offset) => (
                <th
                  key={offset}
                  className="text-left font-medium text-muted-foreground p-1.5 min-w-[9.5rem]"
                >
                  {dayLabelOf(dayKeyOf(weekStart, offset))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-t border-border align-top">
                <td className="sticky left-0 bg-card z-10 p-1.5 text-foreground">
                  <span className="block truncate">@{account.handle}</span>
                  {/* Les familles que ses liaisons couvrent : un binding mal
                      placé se voit ici, au lieu de produire un remplissage faux. */}
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {familiesLine(account.id)}
                  </span>
                </td>
                {dayOffsets.map((offset) => {
                  const dayKey = dayKeyOf(weekStart, offset);
                  const planned = planningByCell.get(`${account.id}|${dayKey}`);
                  if (planned?.length) {
                    // Posée par le planning de la recette : non modifiable ici,
                    // ça se règle sur la recette du compte.
                    return (
                      <td key={offset} className="p-1.5 space-y-1">
                        {planned.map((t) => (
                          <div key={t.patternBindingId} className="flex items-center gap-1.5">
                            <span className="text-[11.5px] text-foreground truncate">
                              {t.label}
                            </span>
                            <Chip size="sm">planning</Chip>
                          </div>
                        ))}
                      </td>
                    );
                  }
                  if (occupied.has(`${account.id}|${dayKey}`)) {
                    return (
                      <td key={offset} className="p-1.5">
                        <span className="text-muted-foreground/70 text-[11px]">
                          déjà programmé
                        </span>
                      </td>
                    );
                  }
                  // Éteint APRÈS le planning et l'occupation : une publication qui
                  // va réellement naître doit rester visible, même un jour éteint.
                  // Et surtout pas le « aucune recette disponible » du CellPicker :
                  // l'un est un choix, l'autre un manque de liaison.
                  if (offCells.has(`${account.id}|${dayKey}`)) {
                    return (
                      <td key={offset} className="p-1.5">
                        {/* Un bloc PLEIN, et pas un troisième gris de 11px :
                            « déjà programmé » et « aucune recette disponible » en
                            sont déjà deux, et un trou qu'on a creusé ne doit pas
                            ressembler à une liaison manquante. Le titre dit OÙ ça
                            se règle — sinon on le cherche dans la grille. */}
                        <span
                          title={`@${account.handle} ne publie pas ${dayLabelOf(dayKey)} — éteint dans « Comptes »`}
                          className="block rounded-md bg-muted/60 py-1 text-center text-[11px] text-muted-foreground/70"
                        >
                          —
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td key={offset} className="p-1.5 space-y-1">
                      {Array.from({ length: perDay }, (_, rank) => {
                        const key = cellKey({ accountId: account.id, dayKey, rank });
                        const assignment = byCell.get(key);
                        const options = optionsByCell[key] ?? [];
                        return (
                          <CellPicker
                            key={rank}
                            assignment={assignment}
                            options={options}
                            onPin={(templateId) => onPin(key, templateId)}
                          />
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
      <UnservableAccountsNote accounts={unservableAccounts} familiesLine={familiesLine} />
    </div>
  );
}

/**
 * Les comptes écartés, NOMMÉS.
 *
 * Les masquer serait la pire des options : un compte absent parce qu'une
 * liaison manque ressemblerait à un compte qu'on a désélectionné.
 */
function UnservableAccountsNote({
  accounts,
  familiesLine,
}: {
  accounts: { id: string; handle: string }[];
  familiesLine: (accountId: string) => string;
}) {
  if (accounts.length === 0) return null;
  return (
    <p className="text-[11.5px] text-muted-foreground">
      {accounts.length} compte{accounts.length > 1 ? "s" : ""} sans recette dans les familles
      retenues :{" "}
      {accounts
        .map((a) => {
          const line = familiesLine(a.id);
          return line ? `@${a.handle} (${line})` : `@${a.handle} (aucune recette auto)`;
        })
        .join(" · ")}
    </p>
  );
}

/**
 * Une case : une pastille qui ouvre le menu des alternatives.
 *
 * Remplace une liste déroulante pleine largeur par case — 14 comptes × 5 jours
 * en faisaient soixante-dix, deux écrans de défilement. Les alternatives
 * viennent de `dispatchRecipes`, donc de l'historique RÉELLEMENT vu par cette
 * case : le premier élément du menu est exactement ce que la pastille affiche.
 */
function CellPicker({
  assignment,
  options,
  onPin,
}: {
  assignment?: ReturnType<typeof dispatchRecipes>["assignments"][number];
  options: DispatchOption[];
  onPin: (templateId: string | null) => void;
}) {
  const gapOf = (gap: number | null) => (gap === null ? "jamais" : `${gap} j`);
  const emptyLabel =
    options.length === 0 ? "aucune recette disponible" : "— vide —";

  const items = [
    ...options.map((o) => ({
      label: `${o.candidate.label} · ${gapOf(o.rawGap)}`,
      onClick: () => onPin(o.candidate.patternTemplateId),
    })),
    ...(assignment
      ? [{ label: "Vider la case", destructive: true, onClick: () => onPin(null) }]
      : []),
  ];

  if (items.length === 0) {
    return <span className="block text-[11px] text-muted-foreground/70">{emptyLabel}</span>;
  }

  return (
    <DropdownMenu
      align="start"
      trigger={
        <button
          type="button"
          title={
            assignment
              ? `${assignment.candidate.label} · ${assignment.candidate.publishTime} · ${
                  assignment.gapDays === null
                    ? "jamais servie"
                    : `servie il y a ${assignment.gapDays} j`
                }${assignment.pinned ? " · choix manuel" : ""}`
              : emptyLabel
          }
          className={[
            "w-full inline-flex items-center gap-1 px-1.5 py-1 rounded-md border text-[11.5px] text-left transition-colors",
            assignment
              ? assignment.pinned
                ? // `Chip.variant` est ignoré par le composant : le choix manuel
                  // se marque sur la pastille elle-même, sinon il est invisible.
                  "bg-card border-primary text-foreground"
                : "bg-card border-border text-foreground hover:bg-accent"
              : "bg-card border-dashed border-border text-muted-foreground hover:bg-accent",
          ].join(" ")}
        >
          <span className="flex-1 truncate">
            {assignment ? assignment.candidate.label : emptyLabel}
          </span>
          {assignment && (
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
              {gapOf(assignment.gapDays)}
            </span>
          )}
        </button>
      }
      items={items}
    />
  );
}
