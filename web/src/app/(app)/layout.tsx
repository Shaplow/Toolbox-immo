import { redirect } from "next/navigation";
import { AppNav } from "@/components/layout/AppNav";
import { getUserContext } from "@/lib/userContext";
import { JobEventsProvider } from "@/components/providers/JobEventsProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AppNav
        actualUser={userContext.actualUser}
        effectiveUser={userContext.effectiveUser}
        isImpersonating={userContext.isImpersonating}
      />
      <main className="flex-1 overflow-y-auto">
        <JobEventsProvider>
          {children}
        </JobEventsProvider>
      </main>
    </div>
  );
}
