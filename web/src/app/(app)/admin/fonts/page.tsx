import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { AdminFontsPanel } from "@/components/admin/AdminFontsPanel";

export default async function AdminFontsPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/tools/templates");

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Typographies globales</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gérez les polices partagées dans les templates et l&apos;outil de sous-titres. Cette gestion est réservée aux administrateurs.
        </p>
      </div>
      <AdminFontsPanel />
    </div>
  );
}