import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import {
  canViewMediaLibrary,
  canManageMediaLibraries,
} from "@/lib/permissions/mediaLibrary";
import { prisma } from "@/lib/prisma";
import { Video, Music2, Database, Type, Sparkles, ArrowRight } from "lucide-react";
import { Hub, type HubItem } from "@/components/ui/molecules/Hub";
import { PageShell } from "@/components/ui/PageShell";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || !canViewMediaLibrary(userContext.effectiveUser.role)) {
    redirect("/templates");
  }
  // Le hub ne rend que des liens : seul le niveau library-level l'intéresse
  // (il conditionne la carte « Données » et le bloc « Plus de ressources »).
  const canManage = canManageMediaLibraries(userContext.effectiveUser.role);

  // Compteurs côté serveur — split médias vidéo / audio (Phase β médiathèque).
  const [videoLibCount, audioLibCount, videoAssetCount, audioAssetCount, dataLibCount, dataEntryCount, fontCount, promptCount] =
    await Promise.all([
      prisma.mediaLibrary.count({ where: { type: "video" } }),
      prisma.mediaLibrary.count({ where: { type: "audio" } }),
      prisma.mediaAsset.count({ where: { library: { type: "video" } } }),
      prisma.mediaAsset.count({ where: { library: { type: "audio" } } }),
      prisma.dataLibrary.count(),
      prisma.dataEntry.count(),
      prisma.fontAsset.count(),
      (async () => {
        const [cap, desc] = await Promise.all([
          prisma.captionPrompt.count(),
          prisma.descriptionPrompt.count(),
        ]);
        return cap + desc;
      })(),
    ]);

  // V8 Phase 9 — Hub réduit à 3 cartes principales (Vidéo / Musique /
  // Données). Polices et Prompts IA déclassés en liens discrets en bas du
  // hub (moins consultés au quotidien).
  const items: HubItem[] = [
    {
      href: "/admin/libraries/media",
      label: "Vidéo",
      icon: Video,
      tint: "sky",
      meta: `${videoLibCount} ${videoLibCount === 1 ? "bibliothèque" : "bibliothèques"} · ${videoAssetCount} ${videoAssetCount === 1 ? "vidéo" : "vidéos"}`,
    },
    {
      href: "/admin/libraries/audio",
      label: "Musique",
      icon: Music2,
      tint: "sage",
      meta: `${audioLibCount} ${audioLibCount === 1 ? "bibliothèque" : "bibliothèques"} · ${audioAssetCount} ${audioAssetCount === 1 ? "piste" : "pistes"}`,
    },
    // Données : réservé ADMIN (hors périmètre médiathèque du vidéaste).
    ...(canManage
      ? [
          {
            href: "/admin/libraries/data",
            label: "Données",
            icon: Database,
            tint: "sage" as const,
            meta: `${dataLibCount} ${dataLibCount === 1 ? "bibliothèque" : "bibliothèques"} · ${dataEntryCount} ${dataEntryCount === 1 ? "fiche" : "fiches"}`,
          },
        ]
      : []),
  ];

  return (
    <PageShell variant="narrow">
      <Hub
        eyebrow="Configuration"
        title="Médiathèque"
        items={items}
        cols={3}
      />
      {/* V8 Phase 9 — Ressources avancées en lien discret (rare usage).
          Réservé ADMIN : polices + prompts IA hors périmètre médiathèque du vidéaste. */}
      {canManage && (
        <div className="mt-6 mx-auto max-w-3xl px-6 sm:px-8 pb-12">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground mb-2">
            Plus de ressources
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href="/admin/libraries/fonts"
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border  hover:bg-white/85 transition-colors text-[12.5px] text-foreground group"
            >
              <Type size={14} className="text-danger-700 shrink-0" />
              <span className="flex-1">Typographies</span>
              <span className="text-[11px] text-muted-foreground">{fontCount}</span>
              <ArrowRight
                size={12}
                className="text-muted-foreground group-hover:translate-x-0.5 transition-transform"
              />
            </Link>
            <Link
              href="/admin/prompts"
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border  hover:bg-white/85 transition-colors text-[12.5px] text-foreground group"
            >
              <Sparkles size={14} className="text-warning-700 shrink-0" />
              <span className="flex-1">Prompts IA</span>
              <span className="text-[11px] text-muted-foreground">{promptCount}</span>
              <ArrowRight
                size={12}
                className="text-muted-foreground group-hover:translate-x-0.5 transition-transform"
              />
            </Link>
          </div>
        </div>
      )}
    </PageShell>
  );
}
