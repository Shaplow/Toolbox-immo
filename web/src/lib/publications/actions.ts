/**
 * Verdict centralisé pour les actions déclenchables sur une publication.
 *
 * Avant ce module, chaque section de fiche (CaptionsSection, CoverSection,
 * DescriptionSection, OneOffTriggerButtons, PublishSection) reconstruisait
 * ses propres conditions d'affichage en dur (visible si `canEdit`, désactivé
 * si `!coverPresetId`, etc.). Résultat : règles métier dispersées, faux
 * positifs (bouton "Lancer captions" sur un slot auto_template qui se
 * déclenche automatiquement), faux négatifs (bouton manuel sans message
 * "en attente d'une version livrée").
 *
 * Ce module centralise ces décisions :
 *
 * - Chaque action retourne un `ActionVerdict` :
 *   - `{ visible: false }` → ne pas montrer du tout (action hors contexte,
 *     ex. "Lancer captions" si needsCaptions=false).
 *   - `{ visible: true, enabled: true }` → afficher comme CTA actif.
 *   - `{ visible: true, enabled: false, reason }` → afficher en lecture
 *     seule avec une explication courte (ex. "Auto", "En attente d'une
 *     version livrée", "Pipeline déjà déclenché — voir la section").
 *
 * - L'`intent` typé décrit le motif du verdict, utilisable côté UI pour
 *   choisir un badge (auto / waiting / pending / config-missing).
 *
 * Pas testé côté UI ici — les composants consomment juste le verdict.
 * Les tests unit purs sur ce module garantissent les invariants métier.
 */

export type ActionIntent =
  /** Le job tourne ou tournera automatiquement (pipeline) — pas d'action user. */
  | "auto"
  /** Prérequis non satisfait (ex. version pas encore livrée). */
  | "waiting"
  /** Un job équivalent existe déjà (QUEUED/PROCESSING/COMPLETED) — voir la section. */
  | "pending"
  /** Config incomplète (preset manquant, prompt manquant). */
  | "config-missing"
  /** Bloqué par permission métier (pas pour ce rôle). */
  | "no-permission";

export type ActionVerdict =
  | { visible: false }
  | { visible: true; enabled: true }
  | { visible: true; enabled: false; intent: ActionIntent; reason: string };

// ─── Types d'input partagés ──────────────────────────────────────────────────

export interface PatternForActions {
  /** "auto_template" | "manual_rushes" | "external_upload" */
  source: string;
  needsCaptions: boolean;
  /** "none" | "preFilled" | "autoGenerate" | "manualWrite" */
  needsDescription: string;
  /** "none" | "manualSelect" | "auto" */
  coverMode: string;
}

export interface ResolvedConfigForActions {
  needsCaptions: boolean;
  needsDescription: string;
  coverMode: string;
  coverPresetId: string | null;
  captionPresetId: string | null;
  descriptionPromptId: string | null;
}

export interface ActionContext {
  pattern: PatternForActions | null;
  /** Config résolue (overrides slot + pattern). Utilisée pour les presets. */
  resolved: ResolvedConfigForActions | null;
  /** Render principal du slot, si existant. */
  render: { status: string } | null;
  /** Version courante promue (cible des jobs manuels). */
  currentVersion: { id: string } | null;
  /** Dernier coverPack lié. */
  coverPack: { status: string } | null;
  /** Dernier captionJob lié. */
  latestCaptionJob: { status: string } | null;
  /** true pour ADMIN. */
  isAdmin: boolean;
  /** true si l'utilisateur courant peut éditer ce module (CM ou ADMIN). */
  canEdit: boolean;
}

// ─── Helpers de prédicats ────────────────────────────────────────────────────

function isAutoPipeline(ctx: ActionContext): boolean {
  return ctx.pattern?.source === "auto_template";
}

function hasManualTarget(ctx: ActionContext): boolean {
  // Pour les actions manuelles (cover/captions sur slot one-off), la cible
  // est la version promue. Pour les jobs liés à un render, la présence d'un
  // render suffit.
  return !!ctx.currentVersion || !!ctx.render;
}

function isJobActive(status: string | undefined | null): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

function isJobCompleted(status: string | undefined | null): boolean {
  return status === "COMPLETED" || status === "DONE" || status === "READY";
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Lancer les sous-titres manuellement.
 *
 * Visible seulement si le pattern demande des captions.
 * Masqué (auto) sur les patterns auto_template : le pipeline RunPod déclenche
 * la transcription puis les captions automatiquement après render.
 * Désactivé sans cible (currentVersion / render).
 * Désactivé tant qu'un job équivalent tourne.
 */
export function canTriggerCaptions(ctx: ActionContext): ActionVerdict {
  if (!ctx.canEdit) return { visible: false };
  if (!ctx.pattern || !ctx.pattern.needsCaptions) return { visible: false };

  if (isAutoPipeline(ctx) && !ctx.latestCaptionJob) {
    // Message contextualisé selon l'état du render :
    // - pas de render → en attente du lancement
    // - render PENDING/PROCESSING → en attente fin du rendu
    // - render DONE → captions vont se lancer (transcription en cours côté webhook)
    // - render ERROR → bloqué tant que le rendu n'est pas relancé
    const renderStatus = ctx.render?.status;
    let reason = "Les sous-titres seront générés automatiquement après le rendu.";
    if (renderStatus === "DONE") {
      reason = "Sous-titres en cours de génération automatique…";
    } else if (renderStatus === "PROCESSING" || renderStatus === "PENDING") {
      reason = "Rendu en cours — sous-titres lancés automatiquement à la fin.";
    } else if (renderStatus === "ERROR") {
      reason = "Rendu en échec — relancer le rendu pour générer les sous-titres.";
    }
    return {
      visible: true,
      enabled: false,
      intent: "auto",
      reason,
    };
  }
  if (isJobActive(ctx.latestCaptionJob?.status)) {
    return {
      visible: true,
      enabled: false,
      intent: "pending",
      reason: "Un job de sous-titres est déjà en cours.",
    };
  }
  if (!hasManualTarget(ctx)) {
    return {
      visible: true,
      enabled: false,
      intent: "waiting",
      reason: "En attente d'une version livrée — la cible des sous-titres.",
    };
  }
  return { visible: true, enabled: true };
}

/**
 * Lancer la cover manuellement.
 *
 * Visible seulement si coverMode = "autoPack" ou "manualSelect".
 * Masqué pour coverMode = "none" ou "monteurUpload" (le monteur uploade).
 * Désactivé tant qu'un pack non-FAILED existe (l'admin doit regénérer
 * depuis la section dédiée s'il veut réessayer).
 */
export function canTriggerCover(ctx: ActionContext): ActionVerdict {
  if (!ctx.canEdit) return { visible: false };
  const mode = ctx.resolved?.coverMode ?? ctx.pattern?.coverMode ?? "none";
  if (mode === "none") return { visible: false };
  // monteurUpload : pas de bouton "Lancer cover" — c'est le monteur qui
  // uploade directement via la dropzone dans la CoverSection. Pas d'extraction
  // de pack à déclencher.
  if (mode === "monteurUpload") return { visible: false };

  if (
    ctx.coverPack &&
    ctx.coverPack.status !== "FAILED" &&
    !isJobCompleted(ctx.coverPack.status)
  ) {
    // Pack en cours d'extraction (QUEUED/PROCESSING)
    return {
      visible: true,
      enabled: false,
      intent: "pending",
      reason: "Un pack cover est en cours d'extraction.",
    };
  }
  if (ctx.coverPack && isJobCompleted(ctx.coverPack.status)) {
    // Pack READY : pas de nouveau "Lancer", l'user va choisir dans la section
    return {
      visible: true,
      enabled: false,
      intent: "pending",
      reason: "Pack cover prêt — sélectionne une frame dans la section Cover.",
    };
  }
  if (mode === "autoPack" && !ctx.resolved?.coverPresetId) {
    return {
      visible: true,
      enabled: false,
      intent: "config-missing",
      reason: "Aucun preset cover défini sur le pattern ou en override.",
    };
  }
  if (!hasManualTarget(ctx)) {
    return {
      visible: true,
      enabled: false,
      intent: "waiting",
      reason: "En attente d'une version livrée ou d'un rendu.",
    };
  }
  return { visible: true, enabled: true };
}

/**
 * Générer la description avec l'IA (modal inline ou outil avancé).
 *
 * Visible seulement quand needsDescription = "manualWrite".
 *  - "none" : pas de description requise.
 *  - "preFilled" : pré-rempli depuis la bibliothèque, pas de génération IA.
 *  - "autoGenerate" : le backend déclenche après render — badge "Auto", pas
 *    de bouton manuel.
 *  - "manualWrite" : flow user contrôlé.
 */
export function canGenerateDescription(ctx: ActionContext): ActionVerdict {
  if (!ctx.canEdit) return { visible: false };
  const mode = ctx.resolved?.needsDescription ?? ctx.pattern?.needsDescription ?? "none";
  if (mode === "none") return { visible: false };
  if (mode === "preFilled") return { visible: false };
  if (mode === "autoGenerate") {
    return {
      visible: true,
      enabled: false,
      intent: "auto",
      reason: "Description générée automatiquement après le rendu.",
    };
  }
  // mode === "manualWrite"
  return { visible: true, enabled: true };
}

/**
 * Promouvoir une PublicationVersion comme version courante.
 *
 * Retourne un `coherenceWarning` si des jobs (captions / cover) existent
 * déjà sur l'ancienne version — ils ne sont pas automatiquement re-générés
 * sur la nouvelle, et restent liés à l'ancienne version (incohérence
 * silencieuse). Cf. ClientValidation/VersionsSection.
 */
export function promoteVersionWarning(ctx: ActionContext): string | null {
  const warnings: string[] = [];
  if (ctx.latestCaptionJob && isJobCompleted(ctx.latestCaptionJob.status)) {
    warnings.push("sous-titres");
  }
  if (ctx.coverPack && isJobCompleted(ctx.coverPack.status)) {
    warnings.push("cover");
  }
  if (warnings.length === 0) return null;
  return (
    "Attention : " +
    warnings.join(" et ") +
    " ont déjà été générés sur la version précédente. Tu devras les relancer si tu veux les regénérer sur la nouvelle version courante."
  );
}
