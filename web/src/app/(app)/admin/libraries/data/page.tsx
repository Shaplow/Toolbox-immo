import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { DataLibrariesPanel } from "@/components/admin/libraries/DataLibrariesPanel";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Database } from "lucide-react";

export default async function DataLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/admin/libraries" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-6 transition-colors">
        <ChevronLeft size={13} /> Ressources
      </Link>
      <ToolPageHeader
        icon={Database}
        iconColor="indigo"
        title="Bibliothèques de données"
        subtitle="Campagnes et fiches de données dynamiques utilisées dans les générations."
      />
      <DataLibrariesPanel />
    </div>
  );
}
