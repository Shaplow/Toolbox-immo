import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { PresetsPanel } from "@/components/admin/PresetsPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Layers } from "lucide-react";

export default async function AdminPresetsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/home");

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <ToolPageHeader
        icon={Layers}
        iconColor="violet"
        title="Presets sous-titres"
        subtitle="Gérez les styles de sous-titres partagés. Assignez-les aux utilisateurs depuis Utilisateurs."
      />
      <PresetsPanel />
    </div>
  );
}
