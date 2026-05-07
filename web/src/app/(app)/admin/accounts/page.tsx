import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { InstagramAccountsPanel } from "@/components/admin/InstagramAccountsPanel";

export default async function AdminAccountsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Comptes Instagram</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gérez les comptes clients Instagram et visualisez leur position dans la séquence de thèmes.
        </p>
      </div>
      <InstagramAccountsPanel />
    </div>
  );
}
