import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { AdminFontsPanel } from "@/components/admin/AdminFontsPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Type } from "lucide-react";

export default async function AdminFontsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/tools/templates");

  return (
    <div className="p-8 max-w-5xl mx-auto">
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