import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "./_components/PageHeader";

const SECTIONS = [
  {
    href: "/playground/tokens",
    eyebrow: "Foundations",
    title: "Tokens UI",
    description: "Palette mono, accents sémantiques, brand chirurgical, typo, espacements, élévation, motion, états.",
    stats: "11 stops · 3 accents · 7 tailles typo",
    preview: <FoundationsPreview />,
  },
  {
    href: "/playground/primitives",
    eyebrow: "Components",
    title: "Primitives",
    description: "Button, ButtonIcon, Input, Select, Switch, Tabs, Toast, ConfirmDialog… Mono dark, density Linear, icon-first.",
    stats: "19 composants · 6 familles",
    preview: <ComponentsPreview />,
  },
  {
    href: "/playground/marketing",
    eyebrow: "Marketing",
    title: "Tokens éditoriaux",
    description: "Serif Instrument, signature Caveat, décors HandDrawn, gradient hero, grain texture. Landing only.",
    stats: "Réservé landing",
    preview: <MarketingPreview />,
  },
] as const;

const DOCTRINE = [
  "Geist Sans + monochrome + density Linear + icon-first.",
  "Primary CTA = bg-gray-950 flat. Aucun gradient, aucune couleur, aucun glow.",
  "Brand orange #FF5A1F apparaît à 2 endroits dans toute l’app : logo + dot notif.",
  "Accents sémantiques (success / danger / info) = statuts uniquement.",
  "L’effet « wahou » vient de la rigueur, pas de la couleur.",
];

export default function PlaygroundIndexPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Design system"
        title="Toolbox Immo"
        description={
          <>
            Sandbox interne pour itérer sur les tokens et primitives sans naviguer dans
            l’app. Doctrine complète dans{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-gray-700">
              web/docs/design-system.md
            </code>
            .
          </>
        }
      />

      {/* Doctrine — 5 phrases */}
      <section className="mb-12 rounded-lg border border-gray-200 bg-gray-50/50 p-6">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-4">
          Doctrine — 5 phrases
        </p>
        <ol className="space-y-2.5 text-[13px] text-gray-700 leading-relaxed max-w-2xl">
          {DOCTRINE.map((rule, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-950 text-white text-[9px] font-mono">
                {i + 1}
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Sections cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block rounded-lg border border-gray-200 bg-white overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
          >
            <div className="aspect-[5/3] bg-gray-50 border-b border-gray-200/80 [background-image:radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.04)_1px,transparent_0)] [background-size:14px_14px] flex items-center justify-center p-5">
              {section.preview}
            </div>
            <div className="p-5 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-semibold">
                {section.eyebrow}
              </p>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">
                  {section.title}
                </h2>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-950" />
              </div>
              <p className="text-[12px] text-gray-500 leading-relaxed">{section.description}</p>
              <p className="text-[10.5px] text-gray-400 font-mono pt-1">{section.stats}</p>
            </div>
          </Link>
        ))}
      </section>

      <p className="mt-12 text-[11px] text-gray-400 max-w-prose">
        Cette surface est gardée par <code className="font-mono">NEXT_PUBLIC_DEV_PLAYGROUND=1</code>{" "}
        — invisible en prod par défaut. Pas d’AppNav, pas d’auth : canvas blanc pour
        comparer objectivement.
      </p>
    </div>
  );
}

function FoundationsPreview() {
  const stops = ["white", "gray-100", "gray-300", "gray-500", "gray-700", "gray-950"];
  const hexes: Record<string, string> = {
    white: "#ffffff",
    "gray-100": "#f3f4f6",
    "gray-300": "#d1d5db",
    "gray-500": "#6b7280",
    "gray-700": "#374151",
    "gray-950": "#0a0a0a",
  };
  return (
    <div className="flex items-end gap-1.5">
      {stops.map((stop) => (
        <div
          key={stop}
          style={{ background: hexes[stop] }}
          className="h-16 w-6 rounded-sm border border-gray-200/80 shadow-sm"
        />
      ))}
    </div>
  );
}

function ComponentsPreview() {
  return (
    <div className="flex flex-col items-stretch gap-1.5 w-32">
      <div className="rounded-md bg-gray-950 px-3 py-1.5 text-center text-[11px] font-medium text-white">
        Primary
      </div>
      <div className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-center text-[11px] font-medium text-gray-800">
        Secondary
      </div>
      <div className="rounded-md px-3 py-1.5 text-center text-[11px] font-medium text-gray-700 hover:bg-gray-100">
        Ghost
      </div>
    </div>
  );
}

function MarketingPreview() {
  return (
    <div className="text-center space-y-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-brand-700 font-medium">
        Nouveau
      </p>
      <p className="font-serif italic text-2xl tracking-tight text-gray-950 leading-tight">
        Du shoot<br />au feed.
      </p>
      <p className="font-hand text-base text-gray-700 leading-none">— Léa</p>
    </div>
  );
}
