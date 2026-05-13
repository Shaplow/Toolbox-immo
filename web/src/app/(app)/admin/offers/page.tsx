import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { OffersPanel } from "@/components/admin/OffersPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Tag } from "lucide-react";

export default async function AdminOffersPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <ToolPageHeader
        icon={Tag}
        iconColor="indigo"
        title="Offres"
        subtitle="Gérez les offres commerciales disponibles pour les comptes Instagram et les règles de planification."
      />
      <OffersPanel />
    </div>
  );
}
