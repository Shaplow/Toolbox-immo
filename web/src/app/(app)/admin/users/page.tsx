import { redirect } from "next/navigation";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";

export default async function AdminUsersPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/tools/templates");

  const templates = await prisma.template.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, client: true },
  });

  const presets = await prisma.captionPreset.findMany({
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isBuiltin: true },
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Gestion des utilisateurs</h1>
        <p className="text-sm text-gray-500 mt-1">Créez des comptes, assignez des outils, des templates et des presets de sous-titres.</p>
      </div>
      <UsersPanel
        templates={templates}
        presets={presets}
        currentUserId={userContext.actualUser.id}
        impersonatedUserId={userContext.isImpersonating ? userContext.effectiveUser.id : null}
      />
    </div>
  );
}
