/**
 * Visualisation des tokens du design system (Phase 1).
 *
 * Sert de référence visuelle pour valider la DA avant migration des
 * surfaces. Synchronisé avec `web/src/app/globals.css` et la doc
 * `web/docs/design-system.md`.
 */

const GRAY_SCALE = [
  { name: "white",    hex: "#ffffff", usage: "Fond principal" },
  { name: "gray-50",  hex: "#f9fafb", usage: "Fond subtle, hover discret" },
  { name: "gray-100", hex: "#f3f4f6", usage: "Skeletons, badges neutres" },
  { name: "gray-200", hex: "#e5e7eb", usage: "Bordures par défaut" },
  { name: "gray-300", hex: "#d1d5db", usage: "Bordures fortes, hover" },
  { name: "gray-400", hex: "#9ca3af", usage: "Texte muted, placeholder" },
  { name: "gray-500", hex: "#6b7280", usage: "Icônes secondaires" },
  { name: "gray-600", hex: "#4b5563", usage: "Texte secondaire" },
  { name: "gray-700", hex: "#374151", usage: "Labels forts" },
  { name: "gray-900", hex: "#111827", usage: "Texte primaire alt" },
  { name: "gray-950", hex: "#0a0a0a", usage: "Texte primaire / titres" },
];

const ACCENTS = [
  {
    label: "Succès",
    description: "Validations, statuts OK, mark-published",
    swatches: [
      { name: "success-50",  hex: "#f0fdf4", cls: "bg-success-50" },
      { name: "success-100", hex: "#dcfce7", cls: "bg-success-100" },
      { name: "success-600", hex: "#16a34a", cls: "bg-success-600 text-white" },
      { name: "success-700", hex: "#15803d", cls: "bg-success-700 text-white" },
    ],
  },
  {
    label: "Danger",
    description: "Suppression, erreurs, refus",
    swatches: [
      { name: "danger-50",  hex: "#fef2f2", cls: "bg-danger-50" },
      { name: "danger-100", hex: "#fee2e2", cls: "bg-danger-100" },
      { name: "danger-600", hex: "#dc2626", cls: "bg-danger-600 text-white" },
      { name: "danger-700", hex: "#b91c1c", cls: "bg-danger-700 text-white" },
    ],
  },
  {
    label: "Info",
    description: "Annotations neutres, hints, état programmé",
    swatches: [
      { name: "info-50",  hex: "#eff6ff", cls: "bg-info-50" },
      { name: "info-100", hex: "#dbeafe", cls: "bg-info-100" },
      { name: "info-600", hex: "#2563eb", cls: "bg-info-600 text-white" },
      { name: "info-700", hex: "#1d4ed8", cls: "bg-info-700 text-white" },
    ],
  },
] as const;

const TYPE_SCALE = [
  { token: "text-xs",   sample: "Métadonnées / labels", className: "text-xs" },
  { token: "text-sm",   sample: "Corps secondaire", className: "text-sm" },
  { token: "text-base", sample: "Corps principal — paragraphes", className: "text-base" },
  { token: "text-lg",   sample: "Sous-titres", className: "text-lg" },
  { token: "text-xl",   sample: "Titres de section", className: "text-xl" },
  { token: "text-2xl",  sample: "Titres de page", className: "text-2xl font-semibold tracking-tight" },
  { token: "text-3xl",  sample: "Hero", className: "text-3xl font-semibold tracking-tight" },
];

const SPACING = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24];

const SHADOWS = [
  { token: "shadow-overlay", cls: "shadow-overlay", usage: "Dropdowns, popovers, tooltips" },
  { token: "shadow-modal",   cls: "shadow-modal",   usage: "Modals, dialogs" },
];

const RADII = [
  { token: "rounded-sm", cls: "rounded-sm", value: "4px",  usage: "Inputs serrés, kbd" },
  { token: "rounded-md", cls: "rounded-md", value: "6px",  usage: "Boutons, inputs" },
  { token: "rounded-lg", cls: "rounded-lg", value: "8px",  usage: "Cards" },
  { token: "rounded-xl", cls: "rounded-xl", value: "10px", usage: "Modals" },
];

const DURATIONS = [
  { token: "duration-fast", value: "150ms", usage: "Hover, focus" },
  { token: "duration-base", value: "200ms", usage: "Default (transitions standard)" },
  { token: "duration-slow", value: "350ms", usage: "Apparitions, ouvertures de panneau" },
];

export default function TokensPage() {
  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Tokens</h1>
        <p className="max-w-prose text-sm text-gray-500">
          Source de vérité visuelle du design system. Toute valeur utilisée
          dans les composants doit venir d&apos;ici. Si tu hésites entre
          plusieurs nuances pour un usage, c&apos;est probablement que le
          token sémantique manque — ajoute-le ici avant de l&apos;utiliser.
        </p>
      </header>

      {/* ── Typo ───────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Typographie" subtitle="Geist Sans (texte) + Geist Mono (raccourcis, IDs)" />
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-6">
          {TYPE_SCALE.map((row) => (
            <div key={row.token} className="flex items-baseline gap-4">
              <code className="w-24 shrink-0 text-[11px] text-gray-400 font-mono">{row.token}</code>
              <span className={row.className}>{row.sample}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm">
          <p className="font-mono text-gray-500 mb-2 text-[11px]">font-mono</p>
          <p className="font-mono">
            const handle = &quot;@lola_caupert&quot;;
          </p>
        </div>
      </section>

      {/* ── Palette monochrome ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Palette monochrome"
          subtitle="L'ossature visuelle de l'app. Pas d'accent ici — réservés à la palette sémantique."
        />
        <div className="overflow-hidden rounded-lg border border-gray-200">
          {GRAY_SCALE.map((row, i) => {
            const isLight = ["white", "gray-50", "gray-100", "gray-200", "gray-300", "gray-400"].includes(row.name);
            return (
              <div
                key={row.name}
                style={{ background: row.hex }}
                className={`flex items-center justify-between px-5 py-3 text-[12px] ${isLight ? "text-gray-700" : "text-white"} ${i > 0 ? "border-t border-gray-200/40" : ""}`}
              >
                <span className="font-mono">{row.name}</span>
                <span className="font-mono opacity-70">{row.hex}</span>
                <span className="hidden sm:inline opacity-80">{row.usage}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Accents sémantiques ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Accents sémantiques"
          subtitle="Trois accents seulement. Tout signal coloré doit tomber dans une de ces 3 familles."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {ACCENTS.map((accent) => (
            <div key={accent.label} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">{accent.label}</h3>
                <p className="text-[11px] text-gray-500">{accent.description}</p>
              </div>
              <div className="space-y-1">
                {accent.swatches.map((s) => (
                  <div
                    key={s.name}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-[11px] font-mono ${s.cls}`}
                  >
                    <span>{s.name}</span>
                    <span className="opacity-70">{s.hex}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Spacing ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Espacements"
          subtitle="Échelle 4px (Tailwind par défaut). Privilégier 4/6/8/10/12/16 pour cohérence."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-2">
          {SPACING.map((s) => (
            <div key={s} className="flex items-center gap-3 text-[11px]">
              <code className="w-16 shrink-0 text-gray-400 font-mono">{s * 4}px</code>
              <code className="w-12 shrink-0 text-gray-400 font-mono">p-{s}</code>
              <div style={{ width: `${s * 4}px` }} className="h-3 bg-gray-900" />
            </div>
          ))}
        </div>
      </section>

      {/* ── Radius ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Border-radius" subtitle="Sharp, peu de rondeur — un look précis et net." />
        <div className="grid gap-3 sm:grid-cols-4">
          {RADII.map((r) => (
            <div key={r.token} className="space-y-2">
              <div className={`h-20 border border-gray-300 bg-gray-50 ${r.cls}`} />
              <div className="space-y-0.5">
                <code className="text-[11px] text-gray-700 font-mono block">{r.token}</code>
                <p className="text-[10px] text-gray-400">{r.value} · {r.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Shadows ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Ombres" subtitle="Élévation discrète — overlays uniquement, jamais sur du contenu inline." />
        <div className="grid gap-4 sm:grid-cols-2">
          {SHADOWS.map((s) => (
            <div key={s.token} className="space-y-2">
              <div className={`h-24 rounded-lg border border-gray-200 bg-white ${s.cls}`} />
              <div className="space-y-0.5">
                <code className="text-[11px] text-gray-700 font-mono block">{s.token}</code>
                <p className="text-[10px] text-gray-400">{s.usage}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Animations ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Animations"
          subtitle="Easing unique : cubic-bezier(0.16, 1, 0.3, 1). Opacity/scale > slide. Jamais de bounce."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {DURATIONS.map((d) => (
              <div key={d.token} className="space-y-1">
                <code className="text-[11px] text-gray-700 font-mono block">{d.token}</code>
                <p className="text-[10px] text-gray-400">{d.value}</p>
                <p className="text-[10px] text-gray-500">{d.usage}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-4 space-y-2">
            <p className="text-[11px] text-gray-500">Survol la pastille pour voir l&apos;easing en action :</p>
            <div className="group inline-block">
              <div className="h-10 w-10 rounded-md bg-gray-900 transition-transform duration-200 group-hover:scale-110 group-hover:rounded-xl" />
            </div>
          </div>
        </div>
      </section>

      <p className="border-t border-gray-200 pt-6 text-[11px] text-gray-400">
        Ces tokens doivent être validés (GATE 1) avant de migrer une seule
        surface de l&apos;app. Itère ici tant que tu n&apos;es pas satisfait.
      </p>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-[12px] text-gray-500">{subtitle}</p>}
    </div>
  );
}
