import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/layout/AppNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AppNav user={session.user} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
