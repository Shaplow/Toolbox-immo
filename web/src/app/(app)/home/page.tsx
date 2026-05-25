import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/userContext";
import { HomeAdmin } from "@/components/home/HomeAdmin";
import { HomeMonteur } from "@/components/home/HomeMonteur";
import { HomeCm } from "@/components/home/HomeCm";
import { HomeUser } from "@/components/home/HomeUser";

/**
 * /home — Dispatcher de rôle.
 *
 * Sélectionne le composant d'accueil adapté au rôle de l'utilisateur effectif.
 * La grille d'outils a été déplacée vers /tools.
 */
export default async function HomePage() {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const { effectiveUser } = userContext;
  const role = effectiveUser.role;

  if (role === "ADMIN") {
    return <HomeAdmin userName={effectiveUser.name} />;
  }

  if (role === "MONTEUR") {
    return <HomeMonteur userId={effectiveUser.id} userName={effectiveUser.name} />;
  }

  if (role === "CM") {
    return <HomeCm userId={effectiveUser.id} userName={effectiveUser.name} />;
  }

  // Fallback USER (ou rôle inconnu) : page "rôle non configuré" + lien vers /tools
  return <HomeUser />;
}
