import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import Link from "next/link";
import { Video, Database, Type, Library } from "lucide-react";
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
        title="Bibliothèques"
        subtitle="Vos médias, données et typographies pour la production"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100">
        <Link
          href="/admin/accounts"
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Voir tous les comptes Instagram →
        </Link>
      </div>
    </div>
  );
}
