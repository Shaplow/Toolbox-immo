"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { OfferSchedulePanel } from "@/components/admin/OfferSchedulePanel";
import { OffersPanel } from "@/components/admin/OffersPanel";

type Tab = "rules" | "offers";

function resolveInitialTab(searchParams: ReturnType<typeof useSearchParams>): Tab {
  return searchParams?.get("tab") === "offers" ? "offers" : "rules";
}

export default function OfferSchedulePage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => resolveInitialTab(searchParams));

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={CalendarClock}
        iconColor="indigo"
        title="Planification"
        subtitle="Gérez les offres commerciales et les règles de publication par offre et par créneau horaire."
      />

      {/* Onglets */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("rules")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "rules"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Règles
        </button>
        <button
          onClick={() => setActiveTab("offers")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "offers"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Offres
        </button>
      </div>

      {/* Contenu des onglets */}
      {activeTab === "rules" && <OfferSchedulePanel />}
      {activeTab === "offers" && <OffersPanel />}
    </div>
  );
}
