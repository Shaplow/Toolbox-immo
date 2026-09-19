/**
 * Le choix d'une recette pour une case — le calcul, sans base de données.
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
 * une recette peut être à la fois la plus ancienne (20 jours) ET déjà posée
 * mardi prochain. Le LRU la proposerait lundi. Regarder des deux côtés, c'est
 * exactement ce que fait l'œil sur le calendrier — et ça règle gratuitement le
 * bord de semaine.
 *
 * ── La borne physique, qu'aucun algorithme ne franchit ──
 *
 * Avec N recettes et c publications par jour, l'écart minimum atteignable est
 * `⌊N / c⌋` : dans toute fenêtre de g jours chaque recette apparaît au plus une
 * fois, donc c·g ≤ N. 15 recettes sur 8 comptes qui publient le même jour → 1
 * jour d'écart, point. Le « lundi/mardi » observé était inévitable, et le levier
 * n'est pas l'algorithme : c'est la taille du pool ou le nombre de publications
 * par jour.
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
 * Où une RECETTE est déjà posée, en index de jour.
 *
 * Indexé par `patternTemplateId`, et surtout PAS par gabarit builder : une
 * version précédente regroupait les recettes partageant un gabarit, au motif
 * qu'elles « rendaient le même reel ». C'était une erreur de catégorie — le
 * gabarit est une mise en page, le contenu vient des données — et elle enterrait
 * huit recettes d'un coup dès que l'une d'elles sortait.
 *
 * `allDays` couvre TOUS les comptes, jamais le seul compte de la case : c'est
 * entre comptes que le doublon se voit, puisqu'ils partagent l'audience.
 */
export interface RecipeHistory {
  /** Tous les comptes du périmètre. */
  allDays: number[];
  /** Le même découpé par compte, pour le départage « et sur CE compte ? ». */
  byAccount: Record<string, number[]>;
}

/**
 * Fenêtre d'historique, en jours, de part et d'autre du jour visé.
 * Sert aussi de plafond de distance : au-delà, deux recettes sont « aussi
 * fraîches l'une que l'autre » et les départages suivants tranchent.
 */
export const DISPATCH_WINDOW_DAYS = 120;

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

/** Une alternative classée pour une case — ce que l'écran propose au clic. */
export interface DispatchOption {
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
 * SOURCE UNIQUE : le choix proposé ET la liste des alternatives sortent d'ici.
 * Deux classements séparés divergeraient, et l'admin verrait une liste dont le
 * premier élément n'est pas celui que le système a choisi.
 *
 * Les recettes déjà posées LE MÊME JOUR sont exclues, pas seulement mal
 * classées : proposer deux fois le même reel le même jour sur deux comptes qui
 * partagent l'audience est précisément ce qu'on vient corriger. Un classement
 * vide est donc une réponse valide — « toutes sont déjà sorties aujourd'hui » —
 * et l'appelant doit la traiter comme telle plutôt que de la contourner.
 */
export function rankCandidatesForCell(
  cell: DispatchCell,
  candidates: DispatchCandidate[],
  history: Record<string, RecipeHistory>,
  cap: number = DISPATCH_WINDOW_DAYS,
): DispatchOption[] {
  const day = dayIndexFromKey(cell.dayKey);

  const scored: DispatchOption[] = [];
  for (const candidate of candidates) {
    const h = history[candidate.patternTemplateId];
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
