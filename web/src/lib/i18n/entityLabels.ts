/**
 * Glossaire FR — UI uniquement.
 *
 * Le code (Prisma, types, services) garde les noms originaux (PatternTemplate,
 * PublicationSlot, MediaLibrary). L'UI parle français cohérent.
 *
 * Règle : un terme = un mot. Pas de "Slot" + "Publication" + "PublicationSlot"
 * dans la même page selon l'humeur.
 */

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

/** Source enum PatternTemplate.source → label FR avec tonalité claire. */
export const PATTERN_SOURCE_LABELS: Record<string, string> = {
  auto_template: "Auto (Template)",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

/** Source enum PatternTemplate.source → chip color hint. */
export const PATTERN_SOURCE_COLOR: Record<string, string> = {
  auto_template: "sky",
  manual_rushes: "sage",
  external_upload: "peach",
};

/** Rôle code → label FR court. */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  VIDEASTE: "Vidéaste",
  MONTEUR: "Monteur",
  CM: "CM",
  EXTERNAL_GENERATOR: "Générateur externe",
};

/** Helper : label entité. */
export function entityLabel(
  key: keyof typeof ENTITY_LABELS,
  form: "singular" | "plural" = "singular",
): string {
  return ENTITY_LABELS[key][form];
}
