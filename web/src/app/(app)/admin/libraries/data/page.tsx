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
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <nav className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-3 flex-wrap">
              <Link
                href="/admin/libraries"
                className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
              >
                <ChevronLeft size={10} className="flex-shrink-0" />
                Médiathèque
              </Link>
            </nav>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Médiathèque · Données
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Bibliothèques de données
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  Campagnes et fiches de données dynamiques utilisées dans les générations.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_6px_rgba(111,162,128,0.6)]" />
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
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
