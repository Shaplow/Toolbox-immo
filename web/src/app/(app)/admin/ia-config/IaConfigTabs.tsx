"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

type Tab = "prompts" | "presets";

function resolveInitialTab(searchParams: ReturnType<typeof useSearchParams>): Tab {
  return searchParams?.get("tab") === "presets" ? "presets" : "prompts";
}

export function IaConfigTabs({
  promptsContent,
  presetsContent,
}: {
  promptsContent: ReactNode;
  presetsContent: ReactNode;
}) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => resolveInitialTab(searchParams));

  return (
    <>
      {/* Onglets */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("prompts")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "prompts"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Prompts
        </button>
        <button
          onClick={() => setActiveTab("presets")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "presets"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Presets
        </button>
      </div>

      {/* Contenu des onglets */}
      {activeTab === "prompts" && <div>{promptsContent}</div>}
      {activeTab === "presets" && <div>{presetsContent}</div>}
    </>
  );
}
