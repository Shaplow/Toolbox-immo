import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { OfferSchedulePanel } from "@/components/admin/OfferSchedulePanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { CalendarClock } from "lucide-react";

export default async function OfferSchedulePage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={CalendarClock}
        iconColor="indigo"
        title="Règles de planification"
        subtitle="Configurez les types de contenu et les horaires de publication par offre. Ces règles servent à générer automatiquement les slots du calendrier."
      />
      <OfferSchedulePanel />
    </div>
  );
}
