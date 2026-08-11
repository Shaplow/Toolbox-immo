/**
 * releaseJobSource — libère le média source d'un job arrivé à un état terminal.
 *
 * ## Le problème résolu
 *
 * Un job de transcription ou de captions stocke son média d'entrée sur R2
 * (`inputKey`). Ce fichier n'a plus d'utilité une fois le job terminé — et sur un
 * rush de 100 Go, le garder coûte cher.
 *
 * Jusqu'ici, un seul chemin faisait ce nettoyage : le webhook RunPod. Or le webhook
 * n'arrive **que** si le job a été réellement soumis et traité. Les autres chemins
 * terminaux laissaient le fichier en place indéfiniment :
 *
 * - le sweep admin (`/api/admin/jobs/sweep`), qui passe en FAILED les jobs
 *   abandonnés — donc précisément ceux dont personne ne nettoiera la source ;
 * - une annulation, un job jamais soumis, un échec avant soumission.
 *
 * Pire : comme le sweep laissait `inputKey` renseigné, la clé restait « référencée
 * en DB », donc l'orphan sweep de `r2Cleanup.ts` ne pouvait pas la rattraper non
 * plus. Le fichier devenait définitivement invisible et payant.
 *
 * ## Pourquoi la garde est double (et non négociable)
 *
 * `inputKey` ne désigne PAS toujours un fichier jetable. Deux cas où le supprimer
 * détruit des données d'autres entités :
 *
 * 1. **Transcription du pipeline auto** (`renderId` / `publicationVersionId` non
 *    nuls) : `inputKey` pointe vers la vidéo du render ou de la version montée.
 * 2. **Captions « utiliser la vidéo du slot »** : `resolveSlotSourceVideo` renvoie
 *    `PublicationVersion.r2Key` ou la clé extraite de `Render.videoUrl`, et cette
 *    clé est écrite telle quelle dans `inputKey`. La supprimer efface le montage
 *    du monteur ou la vidéo du render, alors que la ligne DB continue de la pointer.
 *
 * D'où deux vérifications combinées : le flag pipeline auto **et** un contrôle de
 * préfixe. Seules les clés situées sous le préfixe d'upload dédié au job sont
 * supprimables — tout le reste appartient à quelqu'un d'autre.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { deleteFromR2, r2Configured } from "@/lib/r2";

type Db = PrismaClient | Prisma.TransactionClient;

/** Familles de jobs portant un média source potentiellement jetable. */
export type SourceJobKind = "transcription" | "caption";

/**
 * Préfixe R2 sous lequel un job stocke SON média uploadé, par famille.
 *
 * Toute clé hors de ce préfixe appartient à une autre entité (render, version
 * montée, asset de médiathèque) et ne doit jamais être supprimée par ce module.
 */
const DEDICATED_SOURCE_PREFIX: Record<SourceJobKind, string> = {
  transcription: "transcription/",
  caption: "inputs/captions/",
};

type ReleasableJob = {
  id: string;
  inputKey: string | null;
  /** Non nul ⇒ pipeline auto ⇒ la source est partagée, on n'y touche pas. */
  renderId?: string | null;
  publicationVersionId?: string | null;
};

/**
 * Détermine si la source d'un job peut être supprimée.
 *
 * Exporté pour être testable sans Prisma ni R2 : c'est la règle dont une erreur
 * effacerait le montage d'un monteur ou la vidéo d'un render en production.
 */
export function isSourceReleasable(kind: SourceJobKind, job: ReleasableJob): boolean {
  if (!job.inputKey) return false;

  // Clés du stockage disque de dev, pas des objets R2.
  if (job.inputKey.startsWith("local/")) return false;

  // Garde 1 — pipeline auto : `inputKey` pointe vers la vidéo d'un render ou
  // d'une version montée, utilisée ailleurs.
  if (job.renderId || job.publicationVersionId) return false;

  // Garde 2 — préfixe dédié : couvre le cas captions « utiliser la vidéo du
  // slot », où `inputKey` vaut PublicationVersion.r2Key ou la clé du render sans
  // qu'aucun flag ne le signale.
  return job.inputKey.startsWith(DEDICATED_SOURCE_PREFIX[kind]);
}

/**
 * Nulle `inputKey` en DB et supprime l'objet R2 correspondant.
 *
 * L'ordre importe : la DB d'abord, R2 ensuite. Si la suppression R2 échoue, la
 * clé est déjà déréférencée, donc l'orphan sweep de `r2Cleanup.ts` la rattrapera
 * au prochain passage. L'inverse laisserait une ligne pointant vers un objet
 * disparu.
 *
 * Best-effort sur R2 : un échec est loggué mais ne remonte pas, pour ne jamais
 * empêcher une transition d'état métier.
 *
 * @returns true si une source a effectivement été libérée.
 */
export async function releaseJobSource(
  db: Db,
  kind: SourceJobKind,
  job: ReleasableJob,
): Promise<boolean> {
  if (!isSourceReleasable(kind, job)) return false;

  const key = job.inputKey!;

  if (kind === "transcription") {
    await db.transcriptionJob.update({ where: { id: job.id }, data: { inputKey: null } });
  } else {
    await db.captionJob.update({ where: { id: job.id }, data: { inputKey: null } });
  }

  if (r2Configured()) {
    await deleteFromR2(key).catch((err) =>
      console.warn(`[releaseJobSource] suppression R2 échouée key=${key}:`, err),
    );
  }

  return true;
}

/**
 * Libère en lot les sources d'une liste de jobs (usage : sweep admin).
 *
 * @returns Nombre de sources effectivement libérées.
 */
export async function releaseJobSources(
  db: Db,
  kind: SourceJobKind,
  jobs: ReleasableJob[],
): Promise<number> {
  let released = 0;
  for (const job of jobs) {
    try {
      if (await releaseJobSource(db, kind, job)) released++;
    } catch (err) {
      console.warn(`[releaseJobSources] échec sur job=${job.id}:`, err);
    }
  }
  return released;
}
