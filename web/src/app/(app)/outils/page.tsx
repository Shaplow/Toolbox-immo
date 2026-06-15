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
import { Subtitles, FileText, Mic, Wrench } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { parsePermissions } from "@/lib/permissions/parsePermissions";
import { Hub, type HubItem } from "@/components/ui/molecules/Hub";

interface ToolEntry extends HubItem {
  perm: string;
}

const TOOLS: ToolEntry[] = [
  // Templates volontairement retiré : déjà accessible top-level dans la nav.
  {
    perm: "captions",
    href: "/captions",
    label: "Sous-titres",
    description: "Générer et incruster des sous-titres avec presets.",
    icon: Subtitles,
    tint: "sky",
  },
  // Covers retirée du hub : la route `/covers` n'existe pas (bug pré-existant)
  // et les covers ne sont accessibles que dans le contexte d'une publication
  // (`/publications/[id]/cover`). La permission `covers` reste utilisée pour
  // gater la section Cover dans la fiche publication.
  {
    perm: "description",
    href: "/descriptions",
    label: "Descriptions IA",
    description: "Générer les légendes Instagram avec Claude / GPT.",
    icon: FileText,
    tint: "rose",
  },
  {
    perm: "transcription",
    href: "/transcriptions",
    label: "Transcription",
    description: "Transcrire des vidéos en texte (Whisper).",
    icon: Mic,
    tint: "peach",
  },
];

export default async function OutilsHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  const perms = parsePermissions(userContext.effectiveUser.permissions);
  const available = TOOLS.filter((t) => isAdmin || perms.includes(t.perm));

  if (available.length === 0) redirect("/home");

  // Wrench-only fallback si aucun tint (rétro-compat avec l'ancienne version).
  void Wrench;

  return (
    <Hub
      eyebrow="Production"
      title="Outils"
      description="Outils standalone, sans contexte de slot ou pattern."
      items={available}
      cols={3}
    />
  );
}
