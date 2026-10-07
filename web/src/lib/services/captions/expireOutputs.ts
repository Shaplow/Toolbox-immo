/**
 * expireOutputs — supprime les vidéos sous-titrées de l'Atelier restées 60 jours sans
 * activité (règles pures : lib/captions/outputRetention.ts).
 *
 * Appelé par POST /api/cron/caption-retention. La ligne `CaptionJob` est gardée en
 * historique (« Expirée ») : seuls le fichier R2, `outputUrl` et `outputKey` partent.
 *
 * ## Ordre des écritures
 *
 * Pensé pour qu'un incident ne fasse jamais perdre une vidéo vivante, et pour qu'un
 * passage interrompu soit repris tel quel :
 *
 *   1. RÉCLAMER la ligne (`outputExpiredAt` posé, `outputUrl` nul) par un seul
 *      UPDATE … WHERE qui relit la règle d'âge. Un téléchargement arrivé entre la
 *      lecture et l'écriture le fait échouer (0 ligne) : la vidéo reste. À l'inverse,
 *      une ligne réclamée n'est plus téléchargeable (410), donc plus d'activité possible.
 *   2. SUPPRIMER l'objet R2 (un objet déjà absent n'est pas une erreur).
 *   3. EFFACER `outputKey`, seulement une fois R2 confirmé.
 *
 * Si R2 ou la base échoue entre 1 et 3, la ligne reste « en attente » (`outputExpiredAt`
 * posé, `outputKey` encore là). Le passage suivant reprend la suppression, sans jamais
 * rouvrir la vidéo : c'est cet état, et lui seul, qui rend la purge reprenable.
 *
 * ## Garde-fous
 *
 * - R2 non configuré : erreur AVANT toute lecture. Sinon des lignes seraient réclamées
 *   (« Expirée » côté app) sans qu'aucun fichier ne soit supprimé.
 * - Passage à blanc (`dryRun`) : même lecture, même rapport, aucune écriture.
 * - Chaque ligne remontée par le SQL repasse par `isPurgeCandidate` (doublon JS des
 *   filtres) : une ligne refusée n'est jamais supprimée (`skipped.unsafeKey`).
 * - Une clé portée par plusieurs lignes n'est jamais réclamée (`skipped.sharedKey`) :
 *   supprimer l'objet casserait l'autre ligne. Les clés embarquent un horodatage de
 *   création, ce cas ne doit pas exister — s'il apparaît, il est visible dans le rapport.
 * - Disjoncteur `maxDeletes` : au-delà, rien n'est réclamé (`refused`). Il ne retient
 *   pas la reprise des suppressions en attente, déjà décidées par un passage antérieur.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrencySettled } from "@/lib/concurrency";
import { deleteFromR2, listR2ObjectSizes, r2Configured } from "@/lib/r2";
import {
  ATELIER_OUTPUT_KEY_RE,
  CAPTION_OUTPUT_PREFIX,
  CAPTION_OUTPUT_RETENTION_DAYS,
  captionOutputKind,
  captionRetentionCutoff,
  claimGuardWhere,
  isAtelierCaptionJob,
  isPurgeCandidate,
  purgeCandidateWhere,
} from "@/lib/captions/outputRetention";

/** Suppressions R2 simultanées : borne la charge sur le process web unique. */
const CONCURRENCY = 4;

/** Clés rapportées en exemple, de quoi relire un dry-run à l'œil. */
const SAMPLE_SIZE = 20;

export type CaptionRetentionRefusal = { reason: "too_many_candidates"; maxDeletes: number };

export type CaptionRetentionReport = {
  /** Si true, aucune écriture n'a eu lieu (ni base, ni R2). */
  dryRun: boolean;
  retentionDays: number;
  /** ISO : une vidéo sans activité depuis cette date est supprimable. */
  cutoff: string;
  /**
   * Vidéos qu'un passage réel réclamerait : lignes qui passent la re-vérification JS
   * et dont la clé n'est portée que par elles. Les autres sont comptées dans `skipped`.
   */
  candidates: number;
  /** Lignes réclamées par ce passage (`outputExpiredAt` posé). */
  claimed: number;
  /** Réclamées ET supprimées de R2, `outputKey` effacé. */
  deleted: number;
  /** Suppressions en attente d'un passage précédent, terminées par celui-ci. */
  pendingRetried: number;
  /** Lignes encore en attente à la fin du passage (reprises au suivant). */
  pendingLeft: number;
  skipped: {
    /** Lignes dont la clé est portée par plusieurs lignes : jamais réclamées ni supprimées. */
    sharedKey: number;
    /**
     * Lignes refusées par la re-vérification JS (clé hors forme, ou règle SQL en dérive),
     * et suppressions en attente sur une clé hors forme : jamais supprimées.
     */
    unsafeKey: number;
    /** Un téléchargement (ou une autre écriture) a gagné entre la lecture et la réclamation. */
    race: number;
  };
  /** Échecs rencontrés (réclamation, R2, effacement de la clé) : détail dans les logs. */
  errors: number;
  /**
   * Informatif : sous-titrages de l'Atelier encore en QUEUED/PROCESSING plus vieux que
   * `cutoff`. Un statut non terminal n'est jamais purgé : à passer en FAILED (sweep admin).
   */
  nonTerminalStale: number;
  /** Volumes des candidats d'après le listing R2 ; null si le listing a échoué. */
  bytes: { candidates: number; missingInR2: number } | null;
  byKind: { full: number; preview: number };
  /**
   * Statut des candidats. Un FAILED n'a le plus souvent aucun fichier (la clé est posée à
   * la création du job, l'objet n'existe que si le rendu a abouti) : il est réclamé comme
   * les autres, compte dans `candidates` (donc face à `maxDeletes`) et se retrouve dans
   * `bytes.missingInR2`. Le passage à blanc rend ce cas visible avant le passage réel.
   */
  byStatus: { completed: number; failed: number };
  /** `bytes` est null si le listing R2 a échoué. */
  byUser: Record<string, { count: number; bytes: number | null }>;
  /** Premières clés candidates (au plus SAMPLE_SIZE). */
  samples: string[];
  /** Passage réel refusé par le disjoncteur : rien n'a été réclamé. */
  refused: CaptionRetentionRefusal | null;
};

/** `status` : COMPLETED ou FAILED, `isPurgeCandidate` n'en retient pas d'autre. */
type Candidate = { id: string; userId: string; key: string; status: string };
type PendingRow = { id: string; key: string };

/** Champs de `RetentionJob` + de quoi attribuer le volume à un utilisateur. */
const CANDIDATE_SELECT = {
  id: true,
  userId: true,
  status: true,
  slotId: true,
  activeForSlot: { select: { id: true } },
  srtFilename: true,
  outputKey: true,
  outputExpiredAt: true,
  lastAccessedAt: true,
  createdAt: true,
} as const;

/** Lignes réclamées par un passage précédent dont la suppression R2 n'a pas abouti. */
async function loadPending(): Promise<PendingRow[]> {
  const rows = await prisma.captionJob.findMany({
    where: { outputExpiredAt: { not: null }, outputKey: { not: null } },
    select: { id: true, outputKey: true },
  });
  const pending: PendingRow[] = [];
  for (const row of rows) if (row.outputKey) pending.push({ id: row.id, key: row.outputKey });
  return pending;
}

/**
 * Sous-titrages de l'Atelier bloqués en QUEUED/PROCESSING depuis plus longtemps que la
 * rétention. Leur statut les exclut de la purge : le compte dit combien de vidéos
 * échappent à la règle tant que le sweep admin ne les a pas passés en FAILED. La règle
 * « Atelier » vient de `isAtelierCaptionJob`, pas d'un second filtre SQL qui dériverait.
 */
async function countNonTerminalStale(cutoff: Date): Promise<number> {
  const rows = await prisma.captionJob.findMany({
    where: { status: { in: ["QUEUED", "PROCESSING"] }, slotId: null, createdAt: { lt: cutoff } },
    select: { slotId: true, activeForSlot: { select: { id: true } }, srtFilename: true, outputKey: true },
  });
  return rows.filter((row) => isAtelierCaptionJob(row)).length;
}

/**
 * Supprime l'objet R2 puis efface `outputKey`. L'ordre compte : une clé effacée avant la
 * confirmation de R2 ferait perdre la trace d'un fichier encore présent. Ne lève jamais :
 * un échec laisse la ligne en attente pour le passage suivant.
 */
async function removeOutput(
  target: { id: string; key: string },
  clearWhere: Prisma.CaptionJobWhereInput,
): Promise<boolean> {
  try {
    await deleteFromR2(target.key);
    await prisma.captionJob.updateMany({ where: clearWhere, data: { outputKey: null } });
    return true;
  } catch (err) {
    console.error(`[captions/retention] suppression à reprendre id=${target.id} key=${target.key}:`, err);
    return false;
  }
}

export async function expireAtelierCaptionOutputs(opts: {
  dryRun: boolean;
  maxDeletes: number;
  now?: Date;
}): Promise<CaptionRetentionReport> {
  if (!r2Configured()) {
    throw new Error(
      "R2 non configuré : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL requis.",
    );
  }
  const { dryRun, maxDeletes } = opts;
  const now = opts.now ?? new Date();
  const cutoff = captionRetentionCutoff(now);

  // ── Lecture ───────────────────────────────────────────────────────────────
  const [loaded, pending, nonTerminalStale] = await Promise.all([
    prisma.captionJob.findMany({
      where: purgeCandidateWhere(cutoff),
      select: CANDIDATE_SELECT,
      orderBy: { createdAt: "asc" },
    }),
    loadPending(),
    countNonTerminalStale(cutoff),
  ]);

  const report: CaptionRetentionReport = {
    dryRun,
    retentionDays: CAPTION_OUTPUT_RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
    candidates: 0,
    claimed: 0,
    deleted: 0,
    pendingRetried: 0,
    pendingLeft: pending.length,
    skipped: { sharedKey: 0, unsafeKey: 0, race: 0 },
    errors: 0,
    nonTerminalStale,
    bytes: null,
    byKind: { full: 0, preview: 0 },
    byStatus: { completed: 0, failed: 0 },
    byUser: {},
    samples: [],
    refused: null,
  };

  // Le SQL a déjà filtré, mais la suppression d'un fichier ne repose pas sur lui seul.
  const verified: Candidate[] = [];
  for (const row of loaded) {
    const key = row.outputKey;
    if (key && isPurgeCandidate(row, now)) {
      verified.push({ id: row.id, userId: row.userId, key, status: row.status });
    } else {
      report.skipped.unsafeKey++;
      console.error(
        `[captions/retention] ligne remontée par le SQL mais refusée par la re-vérification, jamais supprimée id=${row.id} key=${key}`,
      );
    }
  }

  // Clé portée par plusieurs lignes (tous statuts confondus) : on n'y touche pas.
  const groups = verified.length
    ? await prisma.captionJob.groupBy({
        by: ["outputKey"],
        where: { outputKey: { in: verified.map((c) => c.key) } },
        _count: { _all: true },
      })
    : [];
  const sharedKeys = new Set<string | null>();
  for (const group of groups) {
    if (group._count._all <= 1) continue;
    sharedKeys.add(group.outputKey);
    console.error(`[captions/retention] clé portée par ${group._count._all} lignes, jamais supprimée key=${group.outputKey}`);
  }
  const candidates = verified.filter((c) => !sharedKeys.has(c.key));
  report.skipped.sharedKey = verified.length - candidates.length;
  report.candidates = candidates.length;

  // ── Volumes (avant toute suppression : après, il n'y a plus rien à mesurer) ─
  let sizes: Map<string, number> | null = null;
  try {
    sizes = await listR2ObjectSizes([CAPTION_OUTPUT_PREFIX]);
  } catch (err) {
    console.warn("[captions/retention] listing R2 impossible, volumes inconnus :", err);
  }

  let candidateBytes = 0;
  let missingInR2 = 0;
  for (const c of candidates) {
    const size = sizes?.get(c.key);
    if (sizes && size === undefined) missingInR2++;
    candidateBytes += size ?? 0;

    const user = (report.byUser[c.userId] ??= { count: 0, bytes: sizes ? 0 : null });
    user.count++;
    if (user.bytes !== null) user.bytes += size ?? 0;

    const kind = captionOutputKind(c.key);
    if (kind) report.byKind[kind]++;
    if (c.status === "FAILED") report.byStatus.failed++;
    else report.byStatus.completed++;
    if (report.samples.length < SAMPLE_SIZE) report.samples.push(c.key);
  }
  if (sizes) report.bytes = { candidates: candidateBytes, missingInR2 };

  // Une suppression en attente ne vise qu'une vidéo de l'Atelier : toute autre clé est
  // ignorée, et comptée dès le passage à blanc pour que le rapport prédise le réel.
  const retryable: PendingRow[] = [];
  for (const row of pending) {
    if (ATELIER_OUTPUT_KEY_RE.test(row.key)) {
      retryable.push(row);
    } else {
      report.skipped.unsafeKey++;
      console.error(`[captions/retention] suppression en attente sur une clé hors forme, ignorée id=${row.id} key=${row.key}`);
    }
  }

  if (dryRun) return report;

  // ── Reprise des suppressions en attente ───────────────────────────────────
  // Réclamées par un passage antérieur : la décision est déjà prise, le disjoncteur
  // ne porte que sur les nouvelles réclamations.
  // Une clé qu'une ligne encore vivante porte toujours ne se supprime pas.
  const held = retryable.length
    ? await prisma.captionJob.findMany({
        where: { outputKey: { in: retryable.map((r) => r.key) }, outputExpiredAt: null },
        select: { outputKey: true },
      })
    : [];
  const heldKeys = new Set(held.map((r) => r.outputKey));
  const toRetry = retryable.filter((r) => !heldKeys.has(r.key));

  const retried = await mapWithConcurrencySettled(toRetry, CONCURRENCY, (row) =>
    removeOutput(row, { id: row.id, outputKey: row.key, outputExpiredAt: { not: null } }),
  );
  for (const outcome of retried) {
    if (outcome.ok && outcome.value) report.pendingRetried++;
    else report.errors++;
  }

  // ── Disjoncteur ───────────────────────────────────────────────────────────
  if (candidates.length > maxDeletes) {
    report.refused = { reason: "too_many_candidates", maxDeletes };
  } else {
    // ── Réclamation puis suppression ────────────────────────────────────────
    const outcomes = await mapWithConcurrencySettled(candidates, CONCURRENCY, async (c) => {
      // La clé lue fait partie de la garde : on ne réclame que ce qu'on a validé.
      const claim = await prisma.captionJob.updateMany({
        where: { ...claimGuardWhere(c.id, cutoff), outputKey: c.key },
        data: { outputExpiredAt: now, outputUrl: null },
      });
      if (claim.count === 0) return "race" as const;
      return (await removeOutput(c, { id: c.id, outputKey: c.key })) ? ("deleted" as const) : ("pending" as const);
    });
    outcomes.forEach((outcome, index) => {
      if (!outcome.ok) {
        // La réclamation a échoué, ou sa réponse s'est perdue après l'écriture : la ligne est
        // intacte ou déjà en attente, et dans les deux cas le prochain passage la reprend.
        report.errors++;
        console.error(`[captions/retention] réclamation en erreur, reprise au prochain passage id=${candidates[index].id}:`, outcome.error);
      } else if (outcome.value === "race") {
        report.skipped.race++;
      } else {
        report.claimed++;
        if (outcome.value === "deleted") report.deleted++;
        else report.errors++;
      }
    });
  }

  report.pendingLeft = pending.length - report.pendingRetried + (report.claimed - report.deleted);
  return report;
}
