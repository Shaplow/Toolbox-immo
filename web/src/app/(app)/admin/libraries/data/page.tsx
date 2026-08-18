import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataLibrariesPanel } from "@/components/admin/libraries/DataLibrariesPanel";
import { LibrariesSubPageShell } from "@/components/admin/libraries/shared/LibrariesSubPageShell";

export default async function DataLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const [libCount, entryCount] = await Promise.all([
    prisma.dataLibrary.count(),
    prisma.dataEntry.count(),
  ]);

  return (
    <LibrariesSubPageShell
      eyebrow="Médiathèque · Données"
      title="Bibliothèques de données"
      subtitle="Fiches de données dynamiques utilisées dans les générations."
      counter={
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success-600 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
          <span className="text-[11px] font-mono text-foreground tabular-nums">
            {libCount} libs · {entryCount} fiches
          </span>
        </div>
      }
    >
      <DataLibrariesPanel />
    </LibrariesSubPageShell>
  );
}
