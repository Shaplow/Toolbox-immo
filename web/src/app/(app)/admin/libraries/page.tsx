import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { Video, Music2, Database, Type, Sparkles } from "lucide-react";
import { Hub, type HubItem } from "@/components/ui/molecules/Hub";

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
    {
      href: "/admin/libraries/fonts",
      label: "Typographies",
      icon: Type,
      tint: "rose",
      meta: `${fontCount} ${fontCount === 1 ? "police" : "polices"}`,
    },
    {
      href: "/admin/prompts",
      label: "Prompts IA",
      icon: Sparkles,
      tint: "peach",
      meta: `${promptCount} ${promptCount === 1 ? "prompt" : "prompts"}`,
    },
  ];

  return (
    <Hub
      eyebrow="Configuration"
      title="Médiathèque"
      items={items}
      cols={3}
    />
  );
}
