import Link from "next/link";

const SECTIONS = [
  {
    href: "/playground/tokens",
    title: "Tokens",
    description: "Palette, typo, espacements, ombres, animations.",
  },
  {
    href: "/playground/primitives",
    title: "Primitives",
    description: "Button, Input, FormField, Dialog, Tooltip, etc.",
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
          Sandbox interne pour valider la direction artistique avant migration
          des surfaces. Voir le plan dans{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">
            /Users/mathis/.claude/plans/ui-boost-plan.md
          </code>{" "}
          et la doc dans{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[12px]">
            web/docs/design-system.md
          </code>
          .
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group block rounded-lg border border-gray-200 bg-white p-5 transition-colors hover:border-gray-400"
          >
            <h2 className="font-semibold tracking-tight text-gray-900 group-hover:underline">
              {section.title}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{section.description}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
