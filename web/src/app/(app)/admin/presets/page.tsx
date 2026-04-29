import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { PresetsPanel } from "@/components/admin/PresetsPanel";

export default async function AdminPresetsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/home");

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Presets de sous-titres</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gérez les styles de sous-titres partagés. Assignez-les aux utilisateurs depuis la page{" "}
          <a href="/admin/users" className="text-indigo-600 hover:underline">Utilisateurs</a>.
        </p>
      </div>
      <PresetsPanel />
    </div>
  );
}
