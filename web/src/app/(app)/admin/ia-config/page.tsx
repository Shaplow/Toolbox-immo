import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import Link from "next/link";
import { MessageSquare, Sparkles, Type } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

export default async function IaConfigHubPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <ToolPageHeader
        icon={Sparkles}
        iconColor="amber"
        title="Config IA"
        subtitle="Prompts et presets pour la génération de contenu"
      />

      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/admin/prompts"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-amber-300 hover:bg-amber-50 transition-colors"
        >
          <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
            <MessageSquare size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Prompts IA</p>
            <p className="text-sm text-gray-500 mt-0.5">Prompts de génération de descriptions immobilières</p>
          </div>
        </Link>

        <Link
          href="/admin/presets"
          className="flex items-start gap-4 p-5 border border-gray-200 rounded-xl hover:border-amber-300 hover:bg-amber-50 transition-colors"
        >
          <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
            <Type size={20} />
          </div>
          <div>
            <p className="font-medium text-gray-900">Presets sous-titres</p>
            <p className="text-sm text-gray-500 mt-0.5">Styles visuels et timings pour les sous-titres</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
