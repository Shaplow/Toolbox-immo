import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlaygroundSidebar } from "./_components/PlaygroundSidebar";

/**
 * Playground sandbox — surface interne pour itérer sur le design system
 * (tokens, primitives, motifs) sans naviguer dans l'app.
 *
 * Gate : visible uniquement si NEXT_PUBLIC_DEV_PLAYGROUND === "1".
 *
 * Layout 2-col : sidebar nav gauche (sticky, scrollspy) + main content.
 * Pas d'AppNav ni d'auth : canvas blanc pour comparer objectivement.
 */
export default function PlaygroundLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEV_PLAYGROUND !== "1") {
    notFound();
  }
  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased">
      <header className="sticky top-0 z-20 border-b border-gray-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-8 py-3 text-sm">
          <Link href="/playground" className="inline-flex items-center gap-2">
            <span className="h-6 w-6 rounded-md bg-brand-600 inline-flex items-center justify-center text-white text-[11px] font-bold">
              T
            </span>
            <span className="font-hand text-xl leading-none text-gray-950">Toolbox</span>
            <span className="text-gray-300">/</span>
            <span className="text-[13px] text-gray-500 font-medium">Design</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/home"
              className="text-[12px] text-gray-500 hover:text-gray-950 transition-colors"
            >
              ← Retour à l&apos;app
            </Link>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              DEV
            </span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1400px] grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <PlaygroundSidebar />
        <main className="px-8 py-10 lg:py-12 lg:pr-12 lg:pl-2 min-w-0">{children}</main>
      </div>
    </div>
  );
}
