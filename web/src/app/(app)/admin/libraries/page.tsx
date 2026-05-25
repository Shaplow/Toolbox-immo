import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import Link from "next/link";
import { Video, Database, Type, Library, Sparkles } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

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
          </div>
        </Link>
      </div>
    </div>
  );
}
