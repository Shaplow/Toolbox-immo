import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { MediaLibrariesPanel } from "@/components/admin/libraries/MediaLibrariesPanel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Film } from "lucide-react";

export default async function MediaLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/admin/libraries" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
        <ChevronLeft size={13} /> Ressources
      </Link>
      <ToolPageHeader
        icon={Film}
        iconColor="indigo"
        title="Bibliothèques médias"
        subtitle="Vos vidéos et musiques disponibles pour la génération."
      />
      <MediaLibrariesPanel />
    </div>
  );
}
