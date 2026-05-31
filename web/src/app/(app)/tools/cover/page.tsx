import { redirect } from "next/navigation";
import { Image as ImageIcon } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { CoverGenerator } from "@/components/covers/CoverGenerator";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

interface PageProps {
  /**
   * Compat back-link : si quelqu'un atterrit ici avec ?slotId=, on redirige
   * vers la sous-route slot-scopée /publications/[id]/cover (workflow précise
   * dédié). Cette page reste utilisée uniquement comme outil **standalone**
   * (extraction de frames sur une vidéo upload ad-hoc, sans rattachement slot).
   */
  searchParams: Promise<{ slotId?: string }>;
}

export default async function CoverPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    redirect("/home");
  }

  const { slotId } = await searchParams;
  // Redirection vers le workflow précise quand un slot est référencé.
  // Sans ça, l'user atterrissait sur l'outil standalone qui n'avait aucun
  // moyen d'attacher le résultat au slot.
  if (slotId && /^[a-zA-Z0-9_-]+$/.test(slotId)) {
    redirect(`/publications/${slotId}/cover`);
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <ToolPageHeader
        icon={ImageIcon}
        iconTint="sage"
        title="Extraction de cover"
        subtitle="Génère des frames depuis une vidéo pour choisir la cover idéale. Mode standalone — pas rattaché à une publication."
      />
      <CoverGenerator />
    </div>
  );
}
