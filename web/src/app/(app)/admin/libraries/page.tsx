import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import Link from "next/link";
import { Video, Database } from "lucide-react";

export default async function LibrariesHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Bibliothèques</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gérez les bibliothèques de médias (vidéos, musiques) et de données texte (RPI, RTIPS…) utilisées dans les templates.
        </p>
      </div>

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
      </div>
    </div>
  );
}
