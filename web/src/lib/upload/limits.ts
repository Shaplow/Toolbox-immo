/**
 * limits — source unique des plafonds de taille d'upload et des paramètres multipart.
 *
 * Avant ce module, `20 * 1024 * 1024 * 1024` était réécrit à l'identique dans 9
 * fichiers (4 routes API + 5 composants) et le trio
 * `MULTIPART_THRESHOLD / PART_SIZE / PART_URL_EXPIRY_SECONDS` dans 4 routes.
 * Chaque changement de plafond devenait une chasse au grep, avec dérive garantie
 * entre la garde client et la garde serveur (le pire cas : le client accepte un
 * fichier que le serveur refuse ensuite en 400, après que l'utilisateur a attendu).
 *
 * Règle : **aucune taille d'upload en dur ailleurs**. Si un nouvel usage a besoin
 * d'un plafond, il s'ajoute ici.
 *
 * ⚠️ Ces plafonds ne s'appliquent qu'aux flux **direct navigateur → R2** (presign
 * + multipart), qui ne traversent ni nginx ni Next.js. Pour les chemins qui
 * transitent par le serveur (form-data legacy, `upload-local` de dev), le vrai
 * plafond est `client_max_body_size` de nginx (2 Go, cf. `scripts/setup-nginx.sh`)
 * et la RAM du process (PM2 redémarre à 2048 Mo) — utiliser
 * `SERVER_PROXIED_MAX_BYTES` pour ces cas.
 */

// ─── Plafonds par nature de fichier ──────────────────────────────────────────

export const UPLOAD_LIMITS = {
  /**
   * Rush vidéo brut : transcription, captions, rushs de publication, rushs
   * d'événement de tournage. 100 Go couvre un export ProRes 422 HQ de ~45 min.
   *
   * Marge technique : R2 plafonne à 10 000 parties par upload multipart, donc à
   * PART_SIZE_BYTES = 128 Mo le plafond théorique est de 1,25 To. Monter cette
   * valeur ne demande donc rien d'autre que de la changer ici — mais relire
   * d'abord PART_URL_EXPIRY_SECONDS ci-dessous.
   */
  RUSH_MAX_BYTES: 100 * 1024 ** 3,

  /**
   * Assets de médiathèque et upload générique. Volontairement **pas** aligné sur
   * RUSH_MAX_BYTES : ces chemins n'implémentent pas le multipart, et R2 rejette
   * tout PUT unique au-delà de 5 Go (400 EntityTooLarge). 2 Go garde une marge.
   */
  VIDEO_ASSET_MAX_BYTES: 2 * 1024 ** 3,

  /** Piste audio de médiathèque. */
  AUDIO_ASSET_MAX_BYTES: 200 * 1024 ** 2,

  /** Pièce jointe d'un brief de publication (PDF, doc, image de référence…). */
  BRIEF_ATTACHMENT_MAX_BYTES: 50 * 1024 ** 2,

  /** Cover uploadée manuellement sur une publication. */
  COVER_MAX_BYTES: 20 * 1024 ** 2,

  /** Image seule (référence de description, poster…). */
  IMAGE_MAX_BYTES: 50 * 1024 ** 2,

  /**
   * Plafond des chemins qui traversent le serveur Next au lieu d'aller
   * directement sur R2 : form-data legacy, `upload-local` de dev, import de
   * bibliothèque. Aligné sur `client_max_body_size 2G` de nginx — au-delà, la
   * requête est coupée par le proxy (ou fait OOM le process avant, la plupart de
   * ces chemins bufferisant le fichier entier en RAM).
   */
  SERVER_PROXIED_MAX_BYTES: 2 * 1024 ** 3,
} as const;

// ─── Paramètres multipart ────────────────────────────────────────────────────

export const MULTIPART = {
  /**
   * Seuil de bascule PUT unique → multipart. En dessous, un seul presign suffit.
   */
  THRESHOLD_BYTES: 100 * 1024 ** 2,

  /**
   * Taille d'une partie. 128 Mo (et non 50 Mo) pour qu'un rush de 100 Go tienne
   * en ~800 parties au lieu de 2048 : le prepare signe toutes les URLs en série
   * et renvoie le lot en une seule réponse JSON, donc le nombre de parties pilote
   * directement la latence et le poids de cette réponse.
   *
   * Changer cette valeur est **sans risque pour les uploads en vol** : le client
   * reçoit `partSize` dans sa réponse de prepare et s'y tient, et
   * `completeMultipartUpload` relit les ETags via ListParts côté serveur sans
   * jamais recalculer les offsets (cf. `lib/r2Multipart.ts`).
   */
  PART_SIZE_BYTES: 128 * 1024 ** 2,

  /**
   * Validité des URLs de parties. Toutes sont signées à t=0, donc cette durée est
   * le **temps total dont dispose l'upload** — il n'existe pas de route de
   * re-signature. 24 h couvre 100 Go dès ~10 Mbps utiles. Plafond dur SigV4 : 7 j.
   *
   * Si RUSH_MAX_BYTES augmente encore, vérifier que ce budget tient toujours à
   * débit réaliste, ou ajouter une re-signature par fenêtre.
   */
  PART_URL_EXPIRY_SECONDS: 24 * 60 * 60,

  /** Validité d'un presign PUT unique (fichiers sous THRESHOLD_BYTES). */
  SINGLE_PUT_EXPIRY_SECONDS: 60 * 60,

  /**
   * Âge au-delà duquel un upload multipart resté en cours est abandonné par le
   * cron de nettoyage, libérant les parties déjà poussées (facturées par R2 tant
   * que l'upload n'est ni finalisé ni abandonné).
   *
   * Doit rester **strictement supérieur** à `PART_URL_EXPIRY_SECONDS` : passé
   * cette validité, l'upload ne peut plus aboutir, donc l'abandonner ne détruit
   * rien de récupérable. Le double laisse une marge franche.
   */
  STALE_ABORT_MS: 48 * 60 * 60 * 1000,
} as const;

// ─── Formatage ───────────────────────────────────────────────────────────────

/**
 * Formate un nombre d'octets pour l'affichage utilisateur, en unités FR.
 *
 * Sert à ce que les messages d'erreur et les libellés d'UI dérivent tous du même
 * plafond que la garde qui les déclenche — un « max 2 Go » écrit à la main
 * survivait aux changements de constante et mentait à l'utilisateur.
 *
 * @example formatMaxSize(UPLOAD_LIMITS.RUSH_MAX_BYTES) // "100 Go"
 * @example formatMaxSize(50 * 1024 ** 2)              // "50 Mo"
 */
export function formatMaxSize(bytes: number): string {
  const GO = 1024 ** 3;
  const MO = 1024 ** 2;
  const KO = 1024;

  if (bytes >= GO) {
    const value = bytes / GO;
    // Pas de décimale inutile : "100 Go" plutôt que "100,0 Go", mais "1,5 Go"
    // reste lisible pour les valeurs non entières.
    return `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")} Go`;
  }
  if (bytes >= MO) {
    const value = bytes / MO;
    return `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")} Mo`;
  }
  if (bytes >= KO) {
    return `${Math.round(bytes / KO)} Ko`;
  }
  return `${bytes} o`;
}

/** Message d'erreur standard pour un dépassement de plafond. */
export function tooLargeMessage(maxBytes: number): string {
  return `Fichier trop volumineux (max ${formatMaxSize(maxBytes)})`;
}
