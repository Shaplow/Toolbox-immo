import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";

interface PageProps {
  /**
   * Compat back-link : si quelqu'un atterrit ici avec ?slotId=, on redirige
   * vers la sous-route slot-scopée /publications/[id]/cover (workflow dédié).
   *
   * V5.A.4 — Le mode standalone (sans slotId) a été retiré : aucun lien
   * interne n'y pointait et aucun usage légitime n'a été identifié. Les
   * frames cover sont désormais générées exclusivement dans le contexte
   * d'une publication. Sans slotId → redirect vers /home pour ne pas
   * laisser une page orpheline accessible. Compat URL préservée si l'admin
   * a un bookmark avec slotId.
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
  if (slotId && /^[a-zA-Z0-9_-]+$/.test(slotId)) {
    redirect(`/publications/${slotId}/cover`);
  }

  // Standalone retiré V5.A.4 — pas d'usage légitime, dead code.
  redirect("/home");
}
