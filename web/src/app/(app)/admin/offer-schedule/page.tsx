"use client";

import { CalendarClock } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { OffersPanel } from "@/components/admin/OffersPanel";

export default function OfferSchedulePage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={CalendarClock}
        iconColor="indigo"
        title="Planification"
        subtitle="Gérez les offres commerciales."
      />

      <OffersPanel />
    </div>
  );
}
