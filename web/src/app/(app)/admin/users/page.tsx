import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { prisma } from "@/lib/prisma";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") redirect("/templates");

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
        <p className="text-sm text-gray-500 mt-1">Créez des comptes, assignez des outils, templates et presets captions.</p>
      </div>
      <UsersPanel templates={templates} presets={presets} />
    </div>
  );
}
