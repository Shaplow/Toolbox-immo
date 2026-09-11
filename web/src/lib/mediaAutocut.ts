/**
 * mediaAutocut — vocabulaire et helpers PURS des jobs d'analyse auto (autocut).
 *
 * ⚠️ Aucun import serveur ici (ni prisma, ni sseStore, ni runpod) : ce module est
 * importé par des composants client (`MediaBatchAutocutPanel`,
 * `AutocutFailuresSection`). Les helpers qui touchent la base vivent dans
 * `@/lib/mediaAutocutServer`.
 *
 * Il porte la définition unique de ce qui est « à valider » (REVIEWABLE_FILTER),
 * consommée par le badge de la toolbar, le titre « Review — N à valider » et le
 * bouton « Valider les analyses ». Avant, chacun avait sa propre définition et
 * les chiffres divergeaient : les jobs `failed` / `pending` / `processing`
 * étaient comptés comme du travail à valider (badge « 99+ » permanent).
 */

// ─── Domaine de statuts ───────────────────────────────────────────────────────

/** Statuts MediaAutocutJob — lowercase (divergence historique avec Render/CaptionJob). */
export const AUTOCUT_JOB_STATUSES = ["pending", "processing", "done", "failed"] as const;
export const AUTOCUT_REVIEW_STATUSES = ["pending_review", "accepted", "skipped", "applied"] as const;

export type AutocutJobStatus = (typeof AUTOCUT_JOB_STATUSES)[number];
export type AutocutReviewStatus = (typeof AUTOCUT_REVIEW_STATUSES)[number];

/** Statuts non terminaux : un job dans cet état attend encore un retour worker. */
export const AUTOCUT_ACTIVE_STATUSES: AutocutJobStatus[] = ["pending", "processing"];

/**
 * Seule combinaison réellement actionnable par l'admin dans la file de review.
 *
 * `reviewStatus` vaut "pending_review" DÈS LA CRÉATION du job : filtrer dessus
 * seul (ce que faisaient le badge et loadReviewQueue) compte aussi les jobs
 * en cours et en échec.
 */
export const REVIEWABLE_FILTER = { status: "done", reviewStatus: "pending_review" } as const;

export function reviewableJobWhere(libraryId: string) {
  return { libraryId, ...REVIEWABLE_FILTER };
}

/**
 * Parse un filtre CSV (`?status=done,failed`) contre un domaine fermé.
 * Retourne null si le param est absent, undefined si une valeur est hors domaine
 * (l'appelant répond 400).
 */
export function parseCsvFilter<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T[] | null | undefined {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((p) => !(allowed as readonly string[]).includes(p))) return undefined;
  return parts as T[];
}

// ─── Compteurs ────────────────────────────────────────────────────────────────

export interface AutocutCounts {
  /** done + pending_review — le seul chiffre qui mérite un badge d'action. */
  reviewable: number;
  /** status failed, hors jobs déjà appliqués. */
  failed: number;
  /** pending + processing. */
  inProgress: number;
  /** reviewStatus applied (coupe effective demandée). */
  applied: number;
  total: number;
}

type CountRow = { status: string; reviewStatus: string; _count: { _all: number } };

/**
 * Pure — pliage d'un groupBy(["status","reviewStatus"]).
 *
 * `accepted` (validé, en attente de batch-apply) n'a volontairement pas de
 * compteur : ce n'est ni du travail à valider, ni un échec, ni une coupe faite.
 * Conséquence assumée : `reviewable + failed + inProgress + applied` peut être
 * strictement inférieur à `total`.
 */
export function summarizeAutocutCounts(rows: CountRow[]): AutocutCounts {
  const counts: AutocutCounts = { reviewable: 0, failed: 0, inProgress: 0, applied: 0, total: 0 };
  for (const row of rows) {
    const n = row._count?._all ?? 0;
    counts.total += n;
    if (row.reviewStatus === "applied") {
      counts.applied += n;
      continue; // un job appliqué n'est ni à valider, ni un échec d'analyse
    }
    if (row.status === "done" && row.reviewStatus === "pending_review") counts.reviewable += n;
    else if (row.status === "failed") counts.failed += n;
    else if (row.status === "pending" || row.status === "processing") counts.inProgress += n;
  }
  return counts;
}

// ─── Traduction des messages d'erreur ────────────────────────────────────────

export const AUTOCUT_ERROR_MAX = 500;
/** Au-delà, le message brut devient illisible dans une ligne de liste. */
const RAW_LABEL_MAX = 160;

const UNKNOWN_LABEL = "Erreur inconnue";

interface ErrorRule {
  test: (raw: string) => boolean;
  label: string;
}

/**
 * Traductions des messages techniques produits par le worker et les webhooks.
 * Ordre significatif : la première règle qui matche gagne.
 */
const ERROR_RULES: ErrorRule[] = [
  {
    test: (r) => /RunPod status:\s*TIMED_OUT/i.test(r),
    label: "Le pack RunPod a dépassé son temps d'exécution — une vidéo a bloqué le worker.",
  },
  {
    test: (r) => /RunPod status:\s*(FAILED|CANCELLED)/i.test(r),
    label: "Le job RunPod s'est arrêté avant de rendre ses résultats.",
  },
  {
    test: (r) => /téléchargement/i.test(r) && /(interrompu|toujours en cours après)/i.test(r),
    label: "Téléchargement bloqué — vidéo injoignable ou source trop lente.",
  },
  {
    // Message émis par le worker : « Analyse de « X.mp4 » bloquée après 420s —
    // fichier probablement illisible (piste audio corrompue). » Le mot
    // « transcription » n'y figure pas : matcher dessus raterait tous les cas.
    test: (r) => /analyse de .+bloquée/i.test(r) || /piste audio corrompue/i.test(r),
    label: "Transcription bloquée — vidéo probablement illisible.",
  },
  {
    test: (r) => /pack interrompu/i.test(r),
    label: "Non analysée — le pack a été interrompu par un autre fichier. À relancer.",
  },
  {
    test: (r) => /(budget du pack|temps de traitement du pack)/i.test(r),
    label: "Non analysée — le pack a manqué de temps. À relancer.",
  },
  {
    test: (r) => /Aucun segment Whisper produit/i.test(r),
    label: "Whisper n'a détecté aucune parole dans cette vidéo.",
  },
  {
    test: (r) => /Aucun résultat renvoyé par le worker/i.test(r),
    label: "Le worker n'a rien renvoyé pour ce fichier. À relancer.",
  },
  {
    test: (r) => /Échec soumission RunPod|Soumission RunPod/i.test(r),
    label: "La soumission du pack à RunPod a échoué.",
  },
  {
    test: (r) => /sweep automatique/i.test(r),
    label: "Analyse abandonnée — le worker n'a jamais répondu.",
  },
];

/**
 * Message technique → libellé lisible. Le brut est toujours conservé dans
 * `detail` pour le tooltip : on ne cache jamais l'information d'origine.
 */
export function explainAutocutError(raw: string | null): { label: string; detail: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) return { label: UNKNOWN_LABEL, detail: null };

  const rule = ERROR_RULES.find((r) => r.test(trimmed));
  if (rule) return { label: rule.label, detail: trimmed };

  const label =
    trimmed.length > RAW_LABEL_MAX ? `${trimmed.slice(0, RAW_LABEL_MAX - 1)}…` : trimmed;
  return { label, detail: trimmed };
}

export interface AutocutFailureItem {
  assetId: string;
  filename: string;
  errorMsg: string | null;
}

export interface AutocutFailureGroup {
  label: string;
  detail: string | null;
  items: AutocutFailureItem[];
}

/**
 * Regroupe les échecs par cause lisible. Groupes triés par taille décroissante :
 * la panne qui touche 40 vidéos passe avant celle qui en touche une.
 */
export function groupAutocutFailures(items: AutocutFailureItem[]): AutocutFailureGroup[] {
  const groups = new Map<string, AutocutFailureGroup>();
  for (const item of items) {
    const { label, detail } = explainAutocutError(item.errorMsg);
    const existing = groups.get(label);
    if (existing) {
      existing.items.push(item);
      // Plusieurs messages bruts peuvent partager un libellé : on garde le premier
      // non-null comme échantillon représentatif pour le tooltip.
      if (!existing.detail && detail) existing.detail = detail;
    } else {
      groups.set(label, { label, detail, items: [item] });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label),
  );
}

// ─── Contrat de sortie du worker ─────────────────────────────────────────────

export interface AutocutJobResult {
  job_id: string;
  proposed_start?: number;
  proposed_end?: number;
  transcript_json?: string;
  language?: string;
  fallback?: boolean;
  error?: string;
}

export interface MediaAutocutBatchOutput {
  batch_id?: string;
  results?: AutocutJobResult[];
  error?: string;
}
