/**
 * Single source of truth for tool display metadata.
 * Consumed by home/page.tsx (cards) and AppNav.tsx (nav items).
 *
 * - navLabel   : short label used in the sidebar nav
 * - cardLabel  : longer label used on the home page cards
 * - description: home card description text
 * - Icon       : Lucide icon component (render with your preferred size)
 * - color      : Tailwind color key used by the home card color maps
 * - badge      : optional badge text (e.g. "Bêta"), null if none
 */

import { LayoutTemplate, AlignLeft, Image as ImageIcon, Mic, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ToolKey = "templates" | "captions" | "covers" | "transcription" | "description";

export type ToolMeta = {
  href: string;
  navLabel: string;
  cardLabel: string;
  description: string;
  Icon: LucideIcon;
  color: string;
  badge: string | null;
};

export const TOOL_META: Record<ToolKey, ToolMeta> = {
  templates: {
    href: "/templates",
    navLabel: "Templates",
    cardLabel: "Générateur de templates",
    description:
      "Créez et gérez des templates visuels pour vos annonces immobilières. Générez des visuels personnalisés en quelques clics.",
    Icon: LayoutTemplate,
    color: "indigo",
    badge: null,
  },
  captions: {
    href: "/captions",
    navLabel: "Sous-titres",
    cardLabel: "Sous-titres",
    description:
      "Incrustez des sous-titres stylisés et animés dans vos vidéos de présentation. Animations mot à mot, mise en avant, polices personnalisées.",
    Icon: AlignLeft,
    color: "violet",
    badge: "Bêta",
  },
  covers: {
    href: "/tools/cover",
    navLabel: "Covers",
    cardLabel: "Covers vidéo",
    description:
      "Extrayez les meilleures frames de votre vidéo pour choisir la cover idéale. Tirages successifs, sélection multiple et téléchargement direct.",
    Icon: ImageIcon,
    color: "emerald",
    badge: null,
  },
  transcription: {
    href: "/tools/transcription",
    navLabel: "Transcription",
    cardLabel: "Transcription",
    description:
      "Convertissez audio et vidéo en texte, SRT ou chunks pour l'IA. Identification des intervenants incluse.",
    Icon: Mic,
    color: "teal",
    badge: null,
  },
  description: {
    href: "/tools/description",
    navLabel: "Descriptions",
    cardLabel: "Descriptions IA",
    description:
      "Générez des descriptions de biens immobiliers à partir d'une transcription ou d'un fichier SRT.",
    Icon: FileText,
    color: "amber",
    badge: null,
  },
};

/** Ordered list of tool keys as they should appear in the UI. */
export const TOOL_ORDER: ToolKey[] = [
  "templates",
  "transcription",
  "captions",
  "description",
  "covers",
];
