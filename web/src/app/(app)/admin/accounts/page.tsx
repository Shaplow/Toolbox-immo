import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { InstagramAccountsPanel } from "@/components/admin/InstagramAccountsPanel";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { AtSign } from "lucide-react";

export default async function AdminAccountsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={AtSign}
        iconColor="indigo"
        title="Comptes Instagram"
        subtitle="Gérez les comptes clients et leur position dans la séquence de thèmes."
      />
      <InstagramAccountsPanel />
    </div>
  );
}
