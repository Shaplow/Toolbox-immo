import { redirect } from "next/navigation";
import { AppNav } from "@/components/layout/AppNav";
import { ImpersonationBanner } from "@/components/layout/ImpersonationBanner";
import { AdminCommandPalette } from "@/components/layout/AdminCommandPalette";
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
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AppNav
        actualUser={userContext.actualUser}
        effectiveUser={userContext.effectiveUser}
        isImpersonating={userContext.isImpersonating}
        isRoleOverride={userContext.isRoleOverride}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {userContext.isImpersonating && (
          <ImpersonationBanner effectiveUserLabel={effectiveUserLabel} />
        )}
        {userContext.isRoleOverride && (
          <ImpersonationBanner
            effectiveUserLabel={`Vue ${userContext.effectiveUser.role} (admin)`}
            variant="roleOverride"
          />
        )}
        <div className="flex-1 overflow-y-auto">
          <JobEventsProvider>
            {children}
          </JobEventsProvider>
        </div>
      </main>
      {userContext.canAdminBypass && <AdminCommandPalette />}
    </div>
  );
}
