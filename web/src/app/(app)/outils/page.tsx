/**
 * /outils — Hub des outils standalone.
 *
 * Accessible :
 * - ADMIN : tous les outils visibles (canAdminBypass)
 * - MONTEUR / CM / EXTERNAL_GENERATOR : filtré par permissions individuelles
 * - VIDEASTE : pas de perms standalone par défaut → redirect /home si 0 cards
 *
 * Source : la même que toolNavItem() dans AppNav (cohérence permissions / labels).
 */

import { redirect } from "next/navigation";
import { Subtitles, FileText, ClipboardList, Mic, Wrench, Clapperboard } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { canAccessTool } from "@/lib/permissions/tools";
import { Hub, type HubItem } from "@/components/ui/molecules/Hub";

interface ToolEntry extends HubItem {
  perm: string;
}

const TOOLS: ToolEntry[] = [
  // Missions — création d'une mission (recette + compte optionnel) → génération.
  {
    perm: "mission",
    href: "/missions/new",
    label: "Lancer une mission",
    description: "Générer depuis une recette, compte Instagram optionnel.",
    icon: Clapperboard,
  },
  // Templates volontairement retiré : déjà accessible top-level dans la nav.
  {
    perm: "captions",
    href: "/captions",
    label: "Sous-titres",
    description: "Générer et incruster des sous-titres.",
    icon: Subtitles,
  },
  // Covers retirée du hub : la route `/covers` n'existe pas (bug pré-existant)
  // et les covers ne sont accessibles que dans le contexte d'une publication
  // (`/publications/[id]/cover`). La permission `covers` reste utilisée pour
  // gater la section Cover dans la fiche publication.
  {
    perm: "description",
    href: "/descriptions",
    label: "Descriptions IA",
    description: "Légendes Instagram (Claude / GPT).",
    icon: FileText,
  },
  {
    perm: "brief",
    href: "/briefs",
    label: "Briefs monteur",
    description: "Brief de montage depuis une transcription.",
    icon: ClipboardList,
  },
  {
    perm: "transcription",
    href: "/transcriptions",
    label: "Transcription",
    description: "Vidéos en texte (Whisper).",
    icon: Mic,
  },
];

export default async function OutilsHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  // canAccessTool honore le scope de rôle (ROLE_TOOL_SCOPE) ET les permissions
  // individuelles — cohérent avec le gate serveur des pages outils (hasTool).
  // Avant : perms.includes() ne voyait que les perms individuelles → un outil
  // accordé au niveau rôle (ex. CM) restait invisible dans le hub.
  const isAdmin = userContext.canAdminBypass;
  const available = TOOLS.filter(
    (t) => isAdmin || canAccessTool(userContext.effectiveUser, t.perm),
  );

  if (available.length === 0) redirect("/home");

  // Wrench-only fallback si aucun tint (rétro-compat avec l'ancienne version).
  void Wrench;

  return (
    <Hub
      eyebrow="Production"
      title="Outils"
      items={available}
      cols={3}
    />
  );
}
