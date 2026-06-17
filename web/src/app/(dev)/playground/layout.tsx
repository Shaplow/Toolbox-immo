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
    <div className="relative min-h-screen text-gray-900 antialiased">
      {/* Fond Liquid Glass — wash pastel macOS Tahoe : peach-100 → rose-100
          → sky-100 à 40% opacity sur base blanche. Donne un fond chromatique
          léger mais perceptible pour que les surfaces glass aient quelque
          chose à révéler par contraste. */}
      <div
        className="fixed inset-0 -z-10 bg-white"
        aria-hidden
      />
      <div
        className="fixed inset-0 -z-10 opacity-50"
        style={{ background: "linear-gradient(135deg, #ffe6d0 0%, #f7dde2 50%, #d4e8f3 100%)" }}
        aria-hidden
      />
      <header className="sticky top-0 z-20 surface-glass-soft border-b border-white/40">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-8 lg:pl-10 lg:pr-12 py-3 text-sm">
          <Link href="/playground" className="inline-flex items-center gap-2">
            <span className="h-6 w-6 rounded-md bg-brand-600 inline-flex items-center justify-center text-white text-[11px] font-bold">
              T
            </span>
            <span className="font-hand text-xl leading-none text-foreground">Toolbox</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-[13px] text-muted-foreground font-medium">Design · Liquid Glass</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/home"
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Retour à l&apos;app
            </Link>
            <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-medium text-warning-700 shadow-[var(--ring-glass-edge)]">
              DEV
            </span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1400px] grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <PlaygroundSidebar />
        <main className="px-8 pt-10 pb-32 lg:pt-12 lg:pb-40 lg:pr-12 lg:pl-2 min-w-0">{children}</main>
      </div>
    </div>
  );
}
