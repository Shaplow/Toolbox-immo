import { redirect } from "next/navigation";
import { AppNav } from "@/components/layout/AppNav";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { CommandPaletteHost } from "@/components/layout/CommandPaletteHost";
import { getUserContext } from "@/lib/userContext";
import { JobEventsProvider } from "@/components/providers/JobEventsProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const effectiveUserLabel =
    userContext.effectiveUser.name ??
    userContext.effectiveUser.email ??
    userContext.effectiveUser.id;

  return (
    // fixed inset-0 force le shell à occuper exactement le viewport,
    // peu importe la hauteur du body (qui est min-h-screen extensible).
    // Sans ça, l'aside h-screen interne se positionnait sur le body étiré
    // et le footer user dépassait sous la zone visible.
    <div className="fixed inset-0 flex bg-gray-100/60">
      <AppNav
        actualUser={userContext.actualUser}
        effectiveUser={userContext.effectiveUser}
        isImpersonating={userContext.isImpersonating}
        isRoleOverride={userContext.isRoleOverride}
      />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {userContext.isImpersonating && (
          <ImpersonationBanner effectiveUserLabel={effectiveUserLabel} />
        )}
        {userContext.isRoleOverride && (
          <ImpersonationBanner
            effectiveUserLabel={`Vue ${userContext.effectiveUser.role} (admin)`}
            variant="roleOverride"
          />
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <JobEventsProvider>
            {children}
          </JobEventsProvider>
        </div>
      </main>
      <CommandPaletteHost
        user={{
          id: userContext.effectiveUser.id,
          role: userContext.effectiveUser.role,
          permissions: userContext.effectiveUser.permissions,
          // ADMIN réel uniquement — pas en impersonation ni en role-override
          // (l'admin en "Vue Monteur" voit la palette nav-only, comme s'il
          // était monteur, pour tester l'expérience).
          isAdminReal:
            userContext.actualUser.role === "ADMIN" &&
            !userContext.isImpersonating &&
            !userContext.isRoleOverride,
        }}
      />
    </div>
  );
}
