import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Video, Music2, Database, Type, Sparkles, ArrowRight } from "lucide-react";
import { Hub, type HubItem } from "@/components/ui/molecules/Hub";
import { PageShell } from "@/components/ui/PageShell";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

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
    {
      href: "/admin/libraries/data",
      label: "Données",
      icon: Database,
      tint: "sage",
      meta: `${dataLibCount} ${dataLibCount === 1 ? "bibliothèque" : "bibliothèques"} · ${dataEntryCount} ${dataEntryCount === 1 ? "fiche" : "fiches"}`,
    },
  ];

  return (
    <PageShell variant="narrow">
      <Hub
        eyebrow="Configuration"
        title="Médiathèque"
        items={items}
        cols={3}
      />
      {/* V8 Phase 9 — Ressources avancées en lien discret (rare usage). */}
      <div className="mt-6 mx-auto max-w-3xl px-6 sm:px-8 pb-12">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-2">
          Plus de ressources
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/admin/libraries/fonts"
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700 group"
          >
            <Type size={14} className="text-rose-700 shrink-0" />
            <span className="flex-1">Typographies</span>
            <span className="text-[11px] text-gray-400">{fontCount}</span>
            <ArrowRight
              size={12}
              className="text-gray-400 group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
          <Link
            href="/admin/prompts"
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700 group"
          >
            <Sparkles size={14} className="text-peach-700 shrink-0" />
            <span className="flex-1">Prompts IA</span>
            <span className="text-[11px] text-gray-400">{promptCount}</span>
            <ArrowRight
              size={12}
              className="text-gray-400 group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
