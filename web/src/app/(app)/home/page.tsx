import { redirect } from "next/navigation";

import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { HomeAdmin } from "@/components/home/HomeAdmin";
import { HomeMonteur } from "@/components/home/HomeMonteur";
import { HomeVideaste } from "@/components/home/HomeVideaste";
import { HomeCm } from "@/components/home/HomeCm";
import { HomeExternalClient } from "@/components/home/HomeExternalClient";

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

  // Fallback EXTERNAL_GENERATOR (ou rôle inconnu) — client externe : on
  // liste les templates qu'on lui a attribués, avec un lien vers ses
  // générations dans /listings. Les presets sous-titres ne sont pas exposés
  // (réservés à l'équipe interne — outils granulaires hors scope client).
  const templateAccesses = await prisma.templateAccess.findMany({
    where: { userId: effectiveUser.id },
    include: { template: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Preview de la dernière génération par template — affichée en thumbnail
  // dans chaque card sur l'accueil. On ne charge que les renders DONE de
  // l'utilisateur lui-même (pas ceux d'un autre user partageant le template),
  // et on choisit la source dans l'ordre : finalCoverUrl > pngUrl > videoUrl.
  const ownRenders = await prisma.render.findMany({
    where: {
      status: "DONE",
      listing: { userId: effectiveUser.id },
      templateId: { in: templateAccesses.map((a) => a.template.id) },
    },
    orderBy: { createdAt: "desc" },
    select: {
      templateId: true,
      pngUrl: true,
      videoUrl: true,
      coverFramePack: { select: { status: true, finalCoverUrl: true } },
    },
  });

  const previewByTemplate = new Map<
    string,
    { pngUrl: string | null; videoUrl: string | null; coverUrl: string | null }
  >();
  for (const r of ownRenders) {
    if (!r.templateId || previewByTemplate.has(r.templateId)) continue;
    const cover =
      r.coverFramePack &&
      (r.coverFramePack.status === "READY" || r.coverFramePack.status === "SELECTED")
        ? r.coverFramePack.finalCoverUrl
        : null;
    if (!cover && !r.pngUrl && !r.videoUrl) continue;
    previewByTemplate.set(r.templateId, {
      pngUrl: r.pngUrl,
      videoUrl: r.videoUrl,
      coverUrl: cover,
    });
  }

  return (
    <HomeExternalClient
      permissions={effectiveUser.permissions}
      access={{
        templates: templateAccesses.map((a) => {
          const preview = previewByTemplate.get(a.template.id) ?? null;
          return {
            id: a.template.id,
            name: a.template.name,
            previewUrl: preview?.coverUrl ?? preview?.pngUrl ?? null,
            previewVideoUrl: preview?.coverUrl || preview?.pngUrl ? null : preview?.videoUrl ?? null,
          };
        }),
      }}
    />
  );
}
