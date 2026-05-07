import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { OfferSchedulePanel } from "@/components/admin/OfferSchedulePanel";

export default async function OfferSchedulePage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Règles de planification</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configurez les types de contenu et les horaires de publication par offre.
          Ces règles servent à générer automatiquement les slots du calendrier.
        </p>
      </div>
      <OfferSchedulePanel />
    </div>
  );
}
