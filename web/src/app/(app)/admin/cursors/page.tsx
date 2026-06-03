/**
 * /admin/cursors — gestion des curseurs de rotation par compte/lib.
 *
 * Charge les listes MediaLibrary et DataLibrary côté serveur puis délègue
 * l'interaction à CursorManagementClient (use client).
 *
 * Auth : ADMIN uniquement.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, RotateCw } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { CursorManagementClient } from "@/components/admin/cursors/CursorManagementClient";

export default async function CursorsPage() {
  const userContext = await getUserContext();
  // Code-reviewer C3 : align sur le pattern canonique CLAUDE.md (canAdminBypass,
  // pas actualUser.role). canAdminBypass est true pour les ADMIN, y compris
  // sous impersonation — comme le veulent les routes API correspondantes.
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    redirect("/templates");
  }

  const [mediaLibraries, dataLibraries] = await Promise.all([
    prisma.mediaLibrary.findMany({
      where: { type: "video" },
      select: { id: true, name: true, rotationScope: true, setSequence: true },
      orderBy: { name: "asc" },
    }),
    prisma.dataLibrary.findMany({
      select: { id: true, name: true, rotationScope: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-5xl mx-auto px-6 sm:px-8 pt-6 pb-2">
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
                  Configuration · Rotation
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Curseurs rotation
                </h1>
                <p className="mt-2 text-[14px] text-gray-500 max-w-xl">
                  Désaxez les curseurs de rotation entre les comptes d&apos;une même bibliothèque
                  pour qu&apos;ils ne démarrent pas sur le même contenu.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <RotateCw size={12} className="text-sky-600" />
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  {mediaLibraries.length} vidéo · {dataLibraries.length} données
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-5xl mx-auto">
            <CursorManagementClient
              mediaLibraries={mediaLibraries.map((l) => ({
                id: l.id,
                name: l.name,
                rotationScope: l.rotationScope ?? "per_account",
                setSequence: l.setSequence,
              }))}
              dataLibraries={dataLibraries.map((l) => ({
                id: l.id,
                name: l.name,
                rotationScope: l.rotationScope ?? "shared",
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
