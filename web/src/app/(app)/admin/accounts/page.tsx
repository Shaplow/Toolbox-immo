import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { InstagramAccountsPanel } from "@/components/admin/InstagramAccountsPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { AtSign, ChevronLeft } from "lucide-react";
import Link from "next/link";

export default async function AdminAccountsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-700 transition-colors"
        >
          <ChevronLeft size={12} /> Retour aux clients
        </Link>
      </div>
      <ToolPageHeader
        icon={AtSign}
        iconColor="indigo"
        title="Comptes Instagram"
        subtitle="Vue globale de tous les comptes — pour les opérations en batch. Pour gérer les comptes d'un client spécifique, ouvrez sa fiche."
      />
      <InstagramAccountsPanel />
    </div>
  );
}
