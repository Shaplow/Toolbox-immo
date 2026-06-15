/**
 * Glossaire FR — UI uniquement.
 *
 * Source unique pour : libellés d'entités (Recette, Publication...), enums
 * métier de `PatternTemplate` (source, coverMode, needsDescription,
 * needsCaptionsMode) et rôles.
 *
 * Le code (Prisma, types, services) garde les noms originaux : PatternTemplate,
 * PatternBinding, PublicationSlot, MediaLibrary. L'UI parle français cohérent.
 *
 * Règle : un terme = un mot. Pas de "Slot" + "Publication" + "PublicationSlot"
 * dans la même page selon l'humeur. Pas de SOURCE_LABEL redéclaré localement
 * dans chaque composant — tout passe par ce module.
 */

// ───────────────────────────────────────────────────────────────────────────
// Entités UI
// ───────────────────────────────────────────────────────────────────────────

export const ENTITY_LABELS = {
  // Une PatternTemplate (recette éditoriale réutilisable cross-comptes)
  pattern: {
    singular: "Recette",
    plural: "Recettes",
    article: "la",
    determinant: "une",
  },
  // Un PatternBinding (application d'une recette à un compte avec planning)
  binding: {
    singular: "Application",
    plural: "Applications",
    article: "l'",
    determinant: "une",
  },
  // Un PublicationSlot (créneau de publication)
  slot: {
    singular: "Publication",
    plural: "Publications",
    article: "la",
    determinant: "une",
  },
  // Une MediaLibrary (vidéos, musiques, etc.)
  mediaLibrary: {
    singular: "Bibliothèque vidéo",
    plural: "Bibliothèques vidéo",
    article: "la",
    determinant: "une",
  },
  // Une DataLibrary
  dataLibrary: {
    singular: "Bibliothèque de données",
    plural: "Bibliothèques de données",
    article: "la",
    determinant: "une",
  },
  // Un compte Instagram
  account: {
    singular: "Compte Instagram",
    plural: "Comptes Instagram",
    article: "le",
    determinant: "un",
  },
  // Un client (entité commerciale qui possède N comptes IG)
  client: {
    singular: "Client",
    plural: "Clients",
    article: "le",
    determinant: "un",
  },
  // Une version uploadée par un monteur
  version: {
    singular: "Version",
    plural: "Versions",
    article: "la",
    determinant: "une",
  },
} as const;

/** Helper : label entité. */
export function entityLabel(
  key: keyof typeof ENTITY_LABELS,
  form: "singular" | "plural" = "singular",
): string {
  return ENTITY_LABELS[key][form];
}

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.source — labels + help + chip color
// ───────────────────────────────────────────────────────────────────────────

/** Source enum PatternTemplate.source → label FR. */
export const SOURCE_LABELS_FR: Record<string, string> = {
  auto_template: "Template auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

/** Source enum PatternTemplate.source → aide contextuelle (forms admin). */
export const SOURCE_HELP: Record<string, string> = {
  auto_template:
    "Le rendu vidéo est généré automatiquement depuis un template lié à la recette. Pas de rushes vidéaste à attendre.",
  manual_rushes:
    "Le vidéaste uploade les rushes, le monteur livre une version finale. Active la section Rushes du pipeline.",
  external_upload:
    "Le client uploade directement sa vidéo finale. Pas de rushes, pas de montage interne.",
};

/** Source enum PatternTemplate.source → variante de Chip (couleur). */
export const SOURCE_VARIANT: Record<string, "default" | "sky" | "peach" | "sage"> = {
  auto_template: "sky",
  manual_rushes: "peach",
  external_upload: "sage",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.coverMode
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
// PatternTemplate.needsDescription
// ───────────────────────────────────────────────────────────────────────────

export const NEEDS_DESCRIPTION_LABELS_FR: Record<string, string> = {
  none: "Aucune",
  manualWrite: "Manuelle",
  preFilled: "Pré-remplie",
  autoGenerate: "Auto-générée",
};

export const NEEDS_DESCRIPTION_HELP: Record<string, string> = {
  none: "Pas de description Instagram pour cette recette.",
  manualWrite: "Le CM rédige la description à la main, vide au départ.",
  preFilled:
    "Le CM démarre depuis un modèle pré-rempli puis ajuste avant publication.",
  autoGenerate:
    "Claude (IA) rédige automatiquement la description depuis la transcription. Le CM peut ensuite l'ajuster.",
};

// ───────────────────────────────────────────────────────────────────────────
// PatternTemplate.needsCaptionsMode (V8 — remplace le Boolean needsCaptions)
// ───────────────────────────────────────────────────────────────────────────

export const CAPTIONS_MODE_LABELS_FR: Record<string, string> = {
  none: "Aucun sous-titre",
  auto: "Auto (preset + IA)",
  manual: "Manuel (écrits à la main)",
};

export const CAPTIONS_MODE_HELP: Record<string, string> = {
  none: "Pas de sous-titres sur la vidéo finale.",
  auto:
    "Transcription Whisper + burn-in via preset captions. Le pipeline déclenche tout automatiquement après le rendu.",
  manual:
    "L'éditeur écrit les sous-titres à la main dans l'app (pas de burn-in vidéo, juste un SRT stocké sur le slot).",
};

// ───────────────────────────────────────────────────────────────────────────
// Rôles
// ───────────────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  VIDEASTE: "Vidéaste",
  MONTEUR: "Monteur",
  CM: "CM",
  EXTERNAL_GENERATOR: "Générateur externe",
};
