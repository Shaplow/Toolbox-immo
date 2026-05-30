import { redirect } from "next/navigation";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";

export default async function AdminUsersPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") redirect("/home");

  const templates = await prisma.template.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, client: true },
  });

  const presets = await prisma.captionPreset.findMany({
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isBuiltin: true },
  });

  const totalUsers = await prisma.user.count();
  const usersByRole = await prisma.user.groupBy({
    by: ["role"],
    _count: { _all: true },
  });
  const adminCount = usersByRole.find((r) => r.role === "ADMIN")?._count._all ?? 0;

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Configuration
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Utilisateurs
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  Créez des comptes, assignez des outils, des templates et des presets de
                  sous-titres.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  {totalUsers} comptes · {adminCount} admin
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Inner content */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto">
            <UsersPanel
              templates={templates}
              presets={presets}
              currentUserId={userContext.actualUser.id}
              impersonatedUserId={userContext.isImpersonating ? userContext.effectiveUser.id : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
