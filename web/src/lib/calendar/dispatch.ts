/**
 * Répartition des reels auto entre les comptes — le calcul, sans base de données.
 *
 * LE BESOIN : « j'essaie de dispatcher correctement les reels entre tous les
 * comptes pour pas qu'on se retrouve avec 2× le même reel posté trop
 * rapidement ». Fait à l'œil sur le calendrier, ça rate : la même recette est
 * partie lundi sur un compte et mardi sur un autre, alors que les comptes
 * partagent la même audience.
 *
 * Module PUR, comme `skips.ts` : aucun import Prisma, donc testable sans base
 * ni navigateur — et c'est bien ici que vivent les décisions qu'on veut figer.
 *
 * ── La métrique : distance à l'occurrence la plus proche, PASSÉE OU FUTURE ──
 *
 * Un « moins récemment utilisé » classique reproduirait le bug à l'identique :
 * en remplissant la semaine prochaine, une recette peut être à la fois la plus
 * ancienne (20 jours) ET déjà posée mardi par une session précédente. Le LRU la
 * proposerait lundi. Regarder des deux côtés, c'est exactement ce que fait
 * l'œil sur le calendrier — et ça règle gratuitement le bord de semaine.
 *
 * ── La borne physique, qu'aucun algorithme ne franchit ──
 *
 * Avec N recettes et c publications par jour, l'écart minimum atteignable est
 * `⌊N / c⌋` : dans toute fenêtre de g jours chaque recette apparaît au plus une
 * fois, donc c·g ≤ N. 15 recettes sur 8 comptes qui publient le même jour → 1
 * jour d'écart, point. Le « lundi/mardi » observé était inévitable. D'où
 * `minimumAchievableGap`, à afficher : le levier n'est pas l'algorithme, c'est
 * la taille du pool ou le nombre de publications par jour.
 */

/** Une case à remplir : un compte, un jour civil (Paris), un rang. */
export interface DispatchCell {
  accountId: string;
  /** Jour civil Paris, "YYYY-MM-DD" (cf. `parisDayKey`). */
  dayKey: string;
  /** 0-based — le 2e reel du jour sur le même compte a le rang 1. */
  rank: number;
}

/** Une recette activable sur un compte donné. */
export interface DispatchCandidate {
  patternTemplateId: string;
  patternBindingId: string;
  /**
   * Identité de CE QUE VOIT L'AUDIENCE : le template builder quand la recette
   * en a un, la recette elle-même sinon.
   *
   * Deux recettes distinctes peuvent pointer le même template builder — c'est
   * le cas en vrai, deux « RPI » rendues à l'identique. Espacer par recette les
   * laissait sortir le même jour sur deux comptes : deux fois le même reel,
   * précisément ce qu'on corrige.
   */
  contentKey: string;
  /** "HH:MM" — l'heure de publication de la recette sur ce compte. */
  publishTime: string;
  label: string;
  /**
   * Date de création de la recette, en ms. Départage les recettes JAMAIS
   * servies : sur un pool neuf elles sont toutes à distance infinie, et sans ce
   * critère l'ordre serait celui des cuid — c'est-à-dire aléatoire.
   */
  templateCreatedAt: number;
}

/**
 * Où un CONTENU est déjà posé, en index de jour. Indexé par `contentKey`, pas
 * par recette : deux recettes sur le même template builder partagent la pile.
 */
export interface RecipeHistory {
  /** Tous les comptes du périmètre. */
  allDays: number[];
  /** Le même découpé par compte, pour le départage « et sur CE compte ? ». */
  byAccount: Record<string, number[]>;
}

export type DispatchUnfilledReason =
  /** Aucune recette du pool n'est activée sur ce compte. */
  | "no_candidate"
  /** Toutes les recettes disponibles sont déjà posées ce jour-là. */
  | "pool_exhausted_day"
  /** L'admin a vidé la case à la main. */
  | "pinned_empty";

export interface DispatchAssignment {
  cell: DispatchCell;
  candidate: DispatchCandidate;
  /**
   * Distance en jours à l'occurrence la plus proche, AVANT cette assignation.
   * `null` = jamais servie dans la fenêtre. C'est le « il y a N j. » de la case.
   */
  gapDays: number | null;
  /** Choix manuel de l'admin, non recalculé. */
  pinned: boolean;
}

export interface DispatchUnfilled {
  cell: DispatchCell;
  reason: DispatchUnfilledReason;
}

export interface DispatchResult {
  assignments: DispatchAssignment[];
  unfilled: DispatchUnfilled[];
}

/**
 * Fenêtre d'historique, en jours, de part et d'autre de la semaine visée.
 * Sert aussi de plafond de distance : au-delà, deux recettes sont « aussi
 * fraîches l'une que l'autre » et les départages suivants tranchent.
 */
export const DISPATCH_WINDOW_DAYS = 120;

/** Identité d'une case, pour la table des choix manuels. */
export function cellKey(cell: DispatchCell): string {
  return `${cell.accountId}|${cell.dayKey}|${cell.rank}`;
}

/**
 * "YYYY-MM-DD" → nombre de jours depuis l'époque.
 *
 * La clé est déjà un jour civil PARIS (`parisDayKey`) : on peut donc la lire en
 * UTC sans se préoccuper du fuseau ni du changement d'heure. Raisonner en
 * millisecondes à la place produirait des distances fractionnaires — 19:00
 * lundi et 09:00 mardi font 0,58 jour — et « même jour » cesserait de vouloir
 * dire quelque chose.
 */
export function dayIndexFromKey(dayKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return NaN;
  return Math.floor(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000,
  );
}

/** Écart minimum atteignable — la borne physique. `null` si rien à publier. */
export function minimumAchievableGap(
  poolSize: number,
  publicationsPerDay: number,
): number | null {
  if (publicationsPerDay <= 0) return null;
  return Math.floor(poolSize / publicationsPerDay);
}

interface ScoredCandidate {
  candidate: DispatchCandidate;
  /** Distance à l'occurrence la plus proche, plafonnée. */
  gapAll: number;
  /** Distance à la DEUXIÈME plus proche — départage deux recettes à égalité. */
  gapSpread: number;
  /** Distance la plus proche sur CE compte. */
  gapSameAccount: number;
  /** Occurrences dans la fenêtre. */
  usage: number;
  /** Distance réelle (non plafonnée), `null` si jamais servie. */
  rawGap: number | null;
}

/** Les deux plus petites distances entre `day` et une liste de jours. */
function twoClosest(day: number, days: number[], cap: number): [number, number] {
  let first = cap;
  let second = cap;
  for (const d of days) {
    const gap = Math.abs(day - d);
    if (gap >= cap) continue;
    if (gap < first) {
      second = first;
      first = gap;
    } else if (gap < second) {
      second = gap;
    }
  }
  return [first, second];
}

/**
 * Classe les recettes proposables pour une case, de la meilleure à la pire.
 *
 * SOURCE UNIQUE : l'assignation automatique ET le menu d'échange de l'écran
 * sortent d'ici. Deux classements séparés divergeraient, et l'admin verrait une
 * liste dont le premier élément n'est pas celui que le système a choisi.
 *
 * Les recettes déjà posées LE MÊME JOUR sont exclues, pas seulement mal
 * classées : proposer deux fois le même reel le même jour sur deux comptes qui
 * partagent l'audience est précisément ce qu'on vient corriger.
 */
export function rankCandidatesForCell(
  cell: DispatchCell,
  candidates: DispatchCandidate[],
  history: Record<string, RecipeHistory>,
  cap: number = DISPATCH_WINDOW_DAYS,
): ScoredCandidate[] {
  const day = dayIndexFromKey(cell.dayKey);

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    const h = history[candidate.contentKey];
    const allDays = h?.allDays ?? [];
    const [gapAll, gapSpread] = twoClosest(day, allDays, cap);
    if (gapAll === 0) continue; // déjà posée ce jour-là — exclusion dure

    const [gapSameAccount] = twoClosest(day, h?.byAccount[cell.accountId] ?? [], cap);
    scored.push({
      candidate,
      gapAll,
      gapSpread,
      gapSameAccount,
      usage: allDays.length,
      rawGap: gapAll >= cap ? null : gapAll,
    });
  }

  scored.sort(
    (a, b) =>
      b.gapAll - a.gapAll ||
      b.gapSpread - a.gapSpread ||
      b.gapSameAccount - a.gapSameAccount ||
      a.usage - b.usage ||
      a.candidate.templateCreatedAt - b.candidate.templateCreatedAt ||
      (a.candidate.patternTemplateId < b.candidate.patternTemplateId ? -1 : 1),
  );
  return scored;
}

/**
 * Ordre de traitement des cases — LE PLUS CONTRAINT D'ABORD.
 *
 * Le point sur lequel une première version était fausse. Avec un compte A qui a
 * 8 recettes actives et deux comptes B et C qui n'en ont que 2 (les mêmes),
 * servir A en premier lui fait prendre une recette rare et laisse C SANS RIEN.
 * En commençant par les comptes les moins pourvus, les trois cases se
 * remplissent — et l'écart obtenu est le même.
 *
 * Le rang passe AVANT le nombre de candidats : avec « 2 par compte et par
 * jour », traiter les deux cases d'un compte à la suite lui donnerait les deux
 * meilleures recettes du jour.
 */
export function orderCells(
  cells: DispatchCell[],
  candidatesByAccount: Record<string, DispatchCandidate[]>,
): DispatchCell[] {
  return [...cells].sort(
    (a, b) =>
      (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0) ||
      a.rank - b.rank ||
      (candidatesByAccount[a.accountId]?.length ?? 0) -
        (candidatesByAccount[b.accountId]?.length ?? 0) ||
      (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0),
  );
}

export interface DispatchInput {
  cells: DispatchCell[];
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  /** Historique existant, hors cases de ce lot. */
  existingUse: Record<string, RecipeHistory>;
  /**
   * Choix manuels de l'admin, par `cellKey`. La valeur est un
   * `patternTemplateId`, ou `null` pour une case volontairement vidée.
   *
   * Sans ça, échanger une case recalculerait tout le reste sous ses pieds.
   */
  pinned?: Record<string, string | null>;
  cap?: number;
}

/**
 * Attribue une recette à chaque case.
 *
 * Glouton, et c'est suffisant : quand tous les comptes partagent le même pool,
 * « prendre la plus éloignée » EST le tourniquet demandé, et chaque recette
 * revient après exactement N assignations.
 *
 * Après chaque attribution, le jour de la case REJOINT l'historique de la
 * recette : les cases suivantes du même jour la voient à distance 0 et
 * l'excluent d'elles-mêmes. C'est ce qui garantit six recettes différentes pour
 * six comptes le même jour, sans règle spéciale.
 *
 * LES CASES ÉPINGLÉES PASSENT D'ABORD, toutes autant qu'elles sont. Un choix
 * manuel est une CONTRAINTE, pas un concurrent : traité dans l'ordre commun, il
 * pouvait se faire voler sa recette par une attribution automatique servie
 * avant lui — et les deux se retrouvaient le même jour. C'est exactement le
 * doublon qu'on corrige, réintroduit par la porte de service.
 */
export function dispatchRecipes({
  cells,
  candidatesByAccount,
  existingUse,
  pinned = {},
  cap = DISPATCH_WINDOW_DAYS,
}: DispatchInput): DispatchResult {
  // Copie de travail : on ne mute jamais l'historique de l'appelant, et les
  // attributions du lot doivent compter pour les cases suivantes.
  const history: Record<string, RecipeHistory> = {};
  for (const [templateId, h] of Object.entries(existingUse)) {
    history[templateId] = {
      allDays: [...h.allDays],
      byAccount: Object.fromEntries(
        Object.entries(h.byAccount).map(([accountId, days]) => [accountId, [...days]]),
      ),
    };
  }

  function remember(templateId: string, accountId: string, day: number) {
    const h = (history[templateId] ??= { allDays: [], byAccount: {} });
    h.allDays.push(day);
    (h.byAccount[accountId] ??= []).push(day);
  }

  const assignments: DispatchAssignment[] = [];
  const unfilled: DispatchUnfilled[] = [];

  const ordered = orderCells(cells, candidatesByAccount);
  const isPinned = (cell: DispatchCell) => pinned[cellKey(cell)] !== undefined;

  // ── 1. Les choix manuels, d'abord et tous ────────────────────────────────
  for (const cell of ordered.filter(isPinned)) {
    const pin = pinned[cellKey(cell)];
    if (pin === null) {
      unfilled.push({ cell, reason: "pinned_empty" });
      continue;
    }
    const chosen = (candidatesByAccount[cell.accountId] ?? []).find(
      (c) => c.patternTemplateId === pin,
    );
    if (!chosen) {
      // La recette a été désactivée sur ce compte depuis l'épinglage.
      unfilled.push({ cell, reason: "no_candidate" });
      continue;
    }
    const day = dayIndexFromKey(cell.dayKey);
    const [gap] = twoClosest(day, history[chosen.contentKey]?.allDays ?? [], cap);
    assignments.push({
      cell,
      candidate: chosen,
      gapDays: gap >= cap ? null : gap,
      pinned: true,
    });
    remember(chosen.contentKey, cell.accountId, day);
  }

  // ── 2. Le reste, glouton ─────────────────────────────────────────────────
  for (const cell of ordered.filter((c) => !isPinned(c))) {
    const candidates = candidatesByAccount[cell.accountId] ?? [];
    if (candidates.length === 0) {
      unfilled.push({ cell, reason: "no_candidate" });
      continue;
    }
    const ranked = rankCandidatesForCell(cell, candidates, history, cap);
    if (ranked.length === 0) {
      // Le compte a bien des recettes, mais toutes sont déjà posées ce jour-là.
      unfilled.push({ cell, reason: "pool_exhausted_day" });
      continue;
    }
    const best = ranked[0];
    assignments.push({
      cell,
      candidate: best.candidate,
      gapDays: best.rawGap,
      pinned: false,
    });
    remember(best.candidate.contentKey, cell.accountId, dayIndexFromKey(cell.dayKey));
  }

  // Rendre les assignations dans l'ordre des cases, pas dans celui du
  // traitement : l'appelant dessine une grille, pas une file d'attente.
  const rank = new Map(ordered.map((c, i) => [cellKey(c), i]));
  assignments.sort((a, b) => rank.get(cellKey(a.cell))! - rank.get(cellKey(b.cell))!);
  unfilled.sort((a, b) => rank.get(cellKey(a.cell))! - rank.get(cellKey(b.cell))!);

  return { assignments, unfilled };
}
