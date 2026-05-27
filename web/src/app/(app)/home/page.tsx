import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { HomeAdmin } from "@/components/home/HomeAdmin";
import { HomeMonteur } from "@/components/home/HomeMonteur";
import { HomeVideaste } from "@/components/home/HomeVideaste";
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

  if (role === "VIDEASTE") {
    return <HomeVideaste userId={effectiveUser.id} userName={effectiveUser.name} />;
  }

  if (role === "CM") {
    return <HomeCm userId={effectiveUser.id} userName={effectiveUser.name} />;
  }

  // Fallback USER (ou rôle inconnu) — accès "générateur externe" : on liste
  // les ressources qui lui ont été attribuées (templates, presets, outils).
  const [templateAccesses, presetAccesses] = await Promise.all([
    prisma.templateAccess.findMany({
      where: { userId: effectiveUser.id },
      include: { template: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.captionPresetAccess.findMany({
      where: { userId: effectiveUser.id },
      include: { preset: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <HomeUser
      permissions={effectiveUser.permissions}
      access={{
        templates: templateAccesses.map((a) => ({ id: a.template.id, name: a.template.name })),
        captionPresets: presetAccesses.map((a) => ({ id: a.preset.id, name: a.preset.name })),
      }}
    />
  );
}
