import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Playground sandbox — surface interne pour itérer sur le design system
 * (tokens, primitives, motifs) sans naviguer dans l'app.
 *
 * Gate : visible uniquement si NEXT_PUBLIC_DEV_PLAYGROUND === "1".
 * Pas de secret — juste un toggle pour éviter de polluer le sitemap prod.
 *
 * Pas d'AppNav ni d'auth : on veut un canvas blanc pour comparer
 * objectivement les composants.
 */
export default function PlaygroundLayout({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEV_PLAYGROUND !== "1") {
    notFound();
  }
  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
          <Link href="/playground" className="inline-flex items-center gap-2">
            <span className="h-6 w-6 rounded-md bg-brand-600 inline-flex items-center justify-center text-white text-[11px] font-bold">T</span>
            <span className="font-hand text-xl leading-none text-gray-950">Toolbox</span>
          </Link>
          <nav className="flex items-center gap-4 text-gray-500">
            <Link href="/playground/tokens" className="hover:text-gray-950 transition-colors">
              Tokens
            </Link>
            <Link href="/playground/primitives" className="hover:text-gray-950 transition-colors">
              Primitives
            </Link>
            <Link href="/playground/marketing" className="hover:text-gray-950 transition-colors">
              Marketing
            </Link>
          </nav>
          <span className="ml-auto rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            DEV
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
