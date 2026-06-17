import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { AdminFontsPanel } from "@/components/admin/AdminFontsPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { ChevronLeft, Type } from "lucide-react";

export default async function AdminFontsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/home");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb retour vers le hub Médiathèque. */}
      <Link
        href="/admin/libraries"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft size={14} />
        Médiathèque
      </Link>
      <ToolPageHeader
        icon={Type}
        iconColor="indigo"
        title="Typographies"
        subtitle="Gérez les polices partagées dans les templates et l'outil de sous-titres."
      />
      <AdminFontsPanel />
    </div>
  );
}