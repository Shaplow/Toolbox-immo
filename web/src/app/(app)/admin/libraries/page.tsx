import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Video, Database, Type, Library, Sparkles } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  // Compteurs côté serveur pour les 4 cards (Phase 1.9 B2)
  const [mediaLibCount, mediaAssetCount, dataLibCount, dataEntryCount, fontCount, promptCount] =
    await Promise.all([
      prisma.mediaLibrary.count(),
      prisma.mediaAsset.count(),
      prisma.dataLibrary.count(),
      prisma.dataEntry.count(),
      prisma.fontAsset.count(),
      // Compter tous les prompts IA (captions + descriptions)
      (async () => {
        const [cap, desc] = await Promise.all([
          prisma.captionPrompt.count(),
          prisma.descriptionPrompt.count(),
        ]);
        return cap + desc;
      })(),
    ]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <ToolPageHeader
        icon={Library}
        iconColor="indigo"
        title="Ressources"
        subtitle="Vos médias, données, typographies et prompts pour la production"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/admin/libraries/media"
          className="flex flex-col gap-3 p-5 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <div className="w-10 h-10 p-2 bg-indigo-100 rounded-lg text-indigo-600 flex items-center justify-center">
            <Video size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Médias</p>
            <p className="text-sm text-gray-500 mt-0.5">Vidéos rush et musiques à lier aux templates</p>
            <p className="text-xs text-gray-400 mt-1">
              {mediaLibCount} {mediaLibCount === 1 ? "bibliothèque" : "bibliothèques"}{" "}
              · {mediaAssetCount} {mediaAssetCount === 1 ? "asset" : "assets"}
            </p>
          </div>
        </Link>

        <Link
          href="/admin/libraries/data"
          className="flex flex-col gap-3 p-5 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <div className="w-10 h-10 p-2 bg-indigo-100 rounded-lg text-indigo-600 flex items-center justify-center">
            <Database size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Données</p>
            <p className="text-sm text-gray-500 mt-0.5">Données texte RPI, RTIPS… importées depuis Excel</p>
            <p className="text-xs text-gray-400 mt-1">
              {dataLibCount} {dataLibCount === 1 ? "bibliothèque" : "bibliothèques"}{" "}
              · {dataEntryCount} {dataEntryCount === 1 ? "fiche" : "fiches"}
            </p>
          </div>
        </Link>

        <Link
          href="/admin/fonts"
          className="flex flex-col gap-3 p-5 border border-gray-200 rounded-xl hover:border-violet-300 hover:bg-violet-50 transition-colors"
        >
          <div className="w-10 h-10 p-2 bg-violet-100 rounded-lg text-violet-600 flex items-center justify-center">
            <Type size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Typographies</p>
            <p className="text-sm text-gray-500 mt-0.5">Polices personnalisées chargées dans les templates</p>
            <p className="text-xs text-gray-400 mt-1">
              {fontCount} {fontCount === 1 ? "police" : "polices"}
            </p>
          </div>
        </Link>

        <Link
          href="/admin/prompts"
          className="flex flex-col gap-3 p-5 border border-gray-200 rounded-xl hover:border-amber-300 hover:bg-amber-50 transition-colors"
        >
          <div className="w-10 h-10 p-2 bg-amber-100 rounded-lg text-amber-600 flex items-center justify-center">
            <Sparkles size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Prompts IA</p>
            <p className="text-sm text-gray-500 mt-0.5">Prompts pour la génération de sous-titres et descriptions</p>
            <p className="text-xs text-gray-400 mt-1">
              {promptCount} {promptCount === 1 ? "prompt" : "prompts"}
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
