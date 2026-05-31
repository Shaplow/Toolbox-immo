/**
 * Labels FR + helps contextuels pour les enums métier de `AccountPattern`.
 *
 * Centralisés ici pour éviter la divergence : avant Phase 2.x, les mêmes
 * tableaux étaient redéfinis dans AccountPatternForm, AccountPatternsList,
 * SlotCard, etc., avec parfois des libellés différents pour la même valeur
 * technique.
 *
 * Pattern P1 du audit UX 2026-05-31 : exposer le jargon technique
 * (`auto_template`, `manual_rushes`, `external_upload`) en français
 * compréhensible pour le configurateur admin.
 */

// ───────────────────────────────────────────────────────────────────────────
// AccountPattern.source
// ───────────────────────────────────────────────────────────────────────────

export const SOURCE_LABELS_FR: Record<string, string> = {
  auto_template: "Génération auto",
  manual_rushes: "Montage manuel",
  external_upload: "Upload externe",
};

export const SOURCE_HELP: Record<string, string> = {
  auto_template:
    "Le rendu vidéo est généré automatiquement depuis un template lié au pattern. Pas de rushes vidéaste à attendre.",
  manual_rushes:
    "Le vidéaste uploade les rushes, le monteur livre une version finale. Active la section Rushes du pipeline.",
  external_upload:
    "Le client uploade directement sa vidéo finale. Pas de rushes, pas de montage interne.",
};

// ───────────────────────────────────────────────────────────────────────────
// AccountPattern.coverMode
// ───────────────────────────────────────────────────────────────────────────

export const COVER_MODE_LABELS_FR: Record<string, string> = {
  none: "Pas de cover",
  manualSelect: "Sélection libre",
  autoPack: "Pack auto → choix CM",
  monteurUpload: "Upload par le monteur",
  // Alias legacy
  auto: "Pack auto → choix CM",
};

export const COVER_MODE_HELP: Record<string, string> = {
  none: "Aucune cover Instagram n'est générée ni demandée.",
  manualSelect:
    "Le CM choisit librement une frame depuis l'outil cover (pas de pack auto).",
  autoPack:
    "Le pipeline génère un pack de frames candidates ; le CM choisit la finale.",
  monteurUpload:
    "Le monteur dépose lui-même l'image de cover (workflow Phase 2.5).",
};

// ───────────────────────────────────────────────────────────────────────────
// AccountPattern.needsDescription
// ───────────────────────────────────────────────────────────────────────────

export const NEEDS_DESCRIPTION_LABELS_FR: Record<string, string> = {
  none: "Aucune",
  manualWrite: "Manuelle",
  preFilled: "Pré-remplie",
  autoGenerate: "Auto-générée",
};

export const NEEDS_DESCRIPTION_HELP: Record<string, string> = {
  none: "Pas de description Instagram pour ce pattern.",
  manualWrite: "Le CM rédige la description à la main, vide au départ.",
  preFilled:
    "Le CM démarre depuis un modèle pré-rempli puis ajuste avant publication.",
  autoGenerate:
    "Claude (IA) rédige automatiquement la description depuis la transcription. Le CM peut ensuite l'ajuster.",
};
