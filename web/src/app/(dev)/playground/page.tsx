import Link from "next/link";

const SECTIONS = [
  {
    href: "/playground/tokens",
    title: "Tokens UI",
    description: "Palette mono, accents sémantiques, brand chirurgical, états UI, density.",
  },
  {
    href: "/playground/primitives",
    title: "Primitives",
    description: "Button, ButtonIcon, Input, Textarea, FormField. Mono, density Linear, icon-first.",
  },
  {
    href: "/playground/marketing",
    title: "Tokens marketing",
    description: "Serif éditoriale, hand signature, décors, gradient hero, grain. Landing only.",
  },
] as const;

export default function PlaygroundIndexPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Design system de Toolbox Immo
        </h1>
        <p className="max-w-prose text-sm text-gray-600">
          Sandbox interne. Doctrine en 5 phrases dans{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">
            web/docs/design-system.md
          </code>
          . Plan dans{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">
            /Users/mathis/.claude/plans/ui-boost-plan.md
          </code>
          .
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block rounded-lg border border-gray-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
          >
            <h2 className="font-semibold tracking-tight text-gray-950">
              {section.title}
            </h2>
            <p className="mt-1 text-[12px] text-gray-500 leading-relaxed">{section.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
