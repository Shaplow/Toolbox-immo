import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import Link from "next/link";
import { Video, Database, Instagram, Type, MessageSquare, Library } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <ToolPageHeader
        icon={Library}
        iconColor="indigo"
        title="Ressources"
        subtitle="Bibliothèques médias, données, polices et prompts IA"
      />

      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/admin/libraries/media"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
            <Video size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Bibliothèques médias</p>
            <p className="text-sm text-gray-500 mt-0.5">Vidéos rush et musiques à lier aux templates</p>
          </div>
        </Link>

        <Link
          href="/admin/libraries/data"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
        >
          <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
            <Database size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Bibliothèques de données</p>
            <p className="text-sm text-gray-500 mt-0.5">Données texte RPI, RTIPS… importées depuis Excel</p>
          </div>
        </Link>

        <Link
          href="/admin/accounts"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-pink-300 hover:bg-pink-50 transition-colors"
        >
          <div className="p-2 bg-pink-100 rounded-lg text-pink-600">
            <Instagram size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Comptes Instagram</p>
            <p className="text-sm text-gray-500 mt-0.5">Clients avec séquence de thèmes et curseurs</p>
          </div>
        </Link>

        <Link
          href="/admin/fonts"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-violet-300 hover:bg-violet-50 transition-colors"
        >
          <div className="p-2 bg-violet-100 rounded-lg text-violet-600">
            <Type size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Typographies</p>
            <p className="text-sm text-gray-500 mt-0.5">Polices personnalisées chargées dans les templates</p>
          </div>
        </Link>

        <Link
          href="/admin/prompts"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-amber-300 hover:bg-amber-50 transition-colors"
        >
          <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
            <MessageSquare size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Prompts IA</p>
            <p className="text-sm text-gray-500 mt-0.5">Prompts de génération de descriptions immobilières</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
