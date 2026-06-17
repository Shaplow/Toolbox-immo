import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { DataLibrariesPanel } from "@/components/admin/libraries/DataLibrariesPanel";

export default async function DataLibrariesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/templates");
  }

  const [libCount, campaignCount] = await Promise.all([
    prisma.dataLibrary.count(),
    prisma.dataCampaign.count(),
  ]);

  return (
    <div className="min-h-screen">
      <div
        className="mx-auto max-w-[1400px] px-6 py-8"
      >
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <nav className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3 flex-wrap">
              <Link
                href="/admin/libraries"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ChevronLeft size={10} className="flex-shrink-0" />
                Médiathèque
              </Link>
            </nav>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                  Médiathèque · Données
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-foreground leading-[1.05]">
                  Bibliothèques de données
                </h1>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Campagnes et fiches de données dynamiques utilisées dans les générations.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border ">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success-600 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                <span className="text-[11px] font-mono text-foreground tabular-nums">
                  {libCount} libs · {campaignCount} campagnes
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto">
            <DataLibrariesPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
