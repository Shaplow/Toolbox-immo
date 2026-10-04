/**
 * staleRules — quand un TranscriptionJob pas encore confié à RunPod est-il mort ?
 *
 * ## Le problème résolu
 *
 * Deux mécanismes passaient en FAILED les jobs « immobiles » sans `runpodJobId` :
 * GET /api/transcription/[id] au bout de 15 min, le sweep admin au bout de 10 min
 * pour les QUEUED. Ils ne distinguaient pas :
 *
 * - un upload abandonné (le fichier n'arrivera jamais) ;
 * - une vidéo **prête** qui attend simplement qu'on clique « Lancer » — le cas
 *   normal d'un lot de 50 vidéos, dont les premières sont prêtes bien avant que
 *   les dernières aient fini leur upload ;
 * - un envoi à RunPod interrompu (PROCESSING sans `runpodJobId`), que l'ancien
 *   message qualifiait à tort de « fichier jamais uploadé ».
 *
 * `uploadedAt` (posé quand l'upload est confirmé) permet de les séparer : une
 * vidéo prête n'expire qu'au bout de plusieurs jours, le temps de libérer un
 * stockage R2 oublié, et non pendant qu'on prépare le lot.
 *
 * Module pur : le traitement (HEAD, écritures gardées) vit dans
 * lib/services/transcription/expireStale.ts. Testé unitairement.
 */

/** Upload jamais confirmé : délai sans signe de vie avant vérification (GET [id]). */
export const UPLOAD_STALL_MS = 15 * 60 * 1000;

/** Sweep admin : même règle, seuil historique plus court. */
export const SWEEP_UPLOAD_STALL_MS = 10 * 60 * 1000;

/**
 * Envoi à RunPod sans `runpodJobId` (job PROCESSING, ou QUEUED du pipeline
 * auto qui reste QUEUED pendant son envoi). 30 min : l'envoi unitaire peut
 * passer par le pod, dont le démarrage le plus lent prévu par le code
 * (podOrchestrator : redémarrage raté puis création) approche 20 min.
 */
export const DISPATCH_STALL_MS = 30 * 60 * 1000;

/**
 * Mode local (dev) : la transcription tourne dans la requête sans jamais recevoir
 * de runpodJobId. Seuil large, aligné sur le PROCESSING 6 h du sweep.
 */
export const LOCAL_PROCESSING_STALL_MS = 6 * 60 * 60 * 1000;

/** Vidéo prête jamais lancée : on libère son stockage au bout de 7 jours. */
export const READY_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StaleReason = "upload_abandoned" | "never_launched" | "dispatch_interrupted";

export const STALE_ERROR_MESSAGES: Record<StaleReason, string> = {
  upload_abandoned: "Upload jamais finalisé : le fichier source n'est pas arrivé",
  never_launched: "Vidéo jamais lancée : retirée au bout de 7 jours",
  dispatch_interrupted: "Envoi au moteur de transcription interrompu",
};

/** Message posé sur une vidéo remise en attente après un envoi interrompu. */
export const DISPATCH_REQUEUED_MESSAGE =
  "L'envoi au moteur de transcription a été interrompu : relancez la vidéo.";

export type PreSubmitJob = {
  status: string;
  runpodJobId: string | null;
  inputKey: string | null;
  uploadedAt: Date | null;
  updatedAt: Date;
  renderId: string | null;
  publicationVersionId: string | null;
};

export type StaleVerdict =
  | { stale: false }
  | {
      stale: true;
      reason: StaleReason;
      /**
       * `upload_abandoned` : vérifier la source avant de conclure (un PUT unique
       * fini sans /upload-complete, ou un job antérieur à `uploadedAt`).
       * `dispatch_interrupted` + `requeue` : la vidéo d'un dépôt standalone est
       * déjà uploadée — la remettre en attente plutôt que la perdre.
       */
      requeue: boolean;
    };

/** Job du pipeline auto : sa source appartient à un render ou une version. */
export function isAutoPipelineJob(job: Pick<PreSubmitJob, "renderId" | "publicationVersionId">): boolean {
  return Boolean(job.renderId || job.publicationVersionId);
}

/**
 * Classe un job sans `runpodJobId`. Un job déjà confié à RunPod relève d'autres
 * règles (`resolveRunpodJobPhase`, sweep PROCESSING 6 h) : jamais stale ici.
 */
export function classifyPreSubmitJob(
  job: PreSubmitJob,
  now: Date,
  opts: {
    uploadStallMs?: number;
    /**
     * Moteur local (pas de RunPod : dev sans R2, ou USE_RUNPOD=false) : un job
     * PROCESSING n'y reçoit jamais de runpodJobId, la transcription tourne dans
     * le process. Seuil long (6 h) au lieu des 30 min d'un envoi RunPod.
     */
    localEngine?: boolean;
  } = {},
): StaleVerdict {
  if (job.runpodJobId) return { stale: false };
  const age = now.getTime() - job.updatedAt.getTime();
  const isAuto = isAutoPipelineJob(job);

  if (job.status === "QUEUED") {
    // Le pipeline auto crée ses jobs QUEUED et les envoie aussitôt : immobile,
    // c'est un envoi raté — pas un upload.
    if (isAuto) {
      return age > DISPATCH_STALL_MS
        ? { stale: true, reason: "dispatch_interrupted", requeue: false }
        : { stale: false };
    }
    if (job.uploadedAt) {
      // `updatedAt` plutôt que `uploadedAt` : un réglage modifié prolonge la vie.
      return age > READY_JOB_TTL_MS
        ? { stale: true, reason: "never_launched", requeue: false }
        : { stale: false };
    }
    return age > (opts.uploadStallMs ?? UPLOAD_STALL_MS)
      ? { stale: true, reason: "upload_abandoned", requeue: false }
      : { stale: false };
  }

  if (job.status === "PROCESSING") {
    // Moteur local : une longue vidéo dépasse 30 min tout en étant vivante.
    if (opts.localEngine || job.inputKey?.startsWith("local/")) {
      return age > LOCAL_PROCESSING_STALL_MS
        ? { stale: true, reason: "dispatch_interrupted", requeue: false }
        : { stale: false };
    }
    return age > DISPATCH_STALL_MS
      ? { stale: true, reason: "dispatch_interrupted", requeue: !isAuto && job.uploadedAt !== null }
      : { stale: false };
  }

  return { stale: false };
}
