/**
 * Visualisation des tokens UI du design system.
 *
 * Surface SaaS d'équipe — tout ce qui apparaît ici est utilisable dans
 * l'app courante (dashboards, panneaux, formulaires). Pour les tokens
 * marketing (serif, hand, gradients, grain, décors), voir
 * `/playground/marketing`.
 *
 * Synchronisé avec `web/src/app/globals.css` et `web/docs/design-system.md`.
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
  { name: "gray-950", hex: "#0a0a0a", usage: "Texte primaire, CTA primary" },
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
  { token: "text-xs",   sample: "Métadonnées / labels" },
  { token: "text-sm",   sample: "Corps secondaire" },
  { token: "text-base", sample: "Corps principal — paragraphes" },
  { token: "text-lg",   sample: "Sous-titres" },
  { token: "text-xl",   sample: "Titres de section" },
  { token: "text-2xl",  sample: "Titres de page" },
  { token: "text-3xl",  sample: "Hero" },
];

const SPACING = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24];

const SHADOWS = [
  { token: "shadow-overlay",       cls: "shadow-overlay",       usage: "Dropdowns, popovers, tooltips" },
  { token: "shadow-modal",         cls: "shadow-modal",         usage: "Modals, dialogs" },
  { token: "shadow-card-elevated", cls: "shadow-card-elevated", usage: "Cards interactives au hover" },
];

const RADII = [
  { token: "rounded-sm", cls: "rounded-sm", value: "4px",  usage: "Inputs serrés, kbd" },
  { token: "rounded-md", cls: "rounded-md", value: "6px",  usage: "Boutons, inputs, badges" },
  { token: "rounded-lg", cls: "rounded-lg", value: "8px",  usage: "Cards" },
  { token: "rounded-xl", cls: "rounded-xl", value: "10px", usage: "Cards élevées" },
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
        <h1 className="text-2xl font-semibold tracking-tight">Tokens UI</h1>
        <p className="max-w-prose text-sm text-gray-500">
          Surface SaaS d&apos;équipe — tout ici est utilisable dans l&apos;app
          courante (dashboards, panneaux, formulaires). Pour les tokens
          marketing (serif éditoriale, signature hand, gradients, grain,
          décors), voir <a href="/playground/marketing" className="underline hover:text-gray-950">/playground/marketing</a>.
        </p>
      </header>

      {/* Doctrine résumée */}
      <div className="rounded-lg border border-gray-200 bg-gray-50/40 p-5 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Doctrine</p>
        <ol className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed list-decimal pl-4">
          <li>Geist Sans + monochrome + density Linear + icon-first.</li>
          <li>Primary CTA = <code className="font-mono text-gray-950">bg-gray-950</code> flat. Aucun gradient, aucune couleur, aucun glow.</li>
          <li>Brand orange #FF5A1F apparaît à 2 endroits dans toute l&apos;app : logo + dot indicateur dans la nav.</li>
          <li>Accents sémantiques (success / danger / info) = statuts uniquement.</li>
          <li>L&apos;effet &laquo; wahou &raquo; vient de la rigueur, pas de la couleur.</li>
        </ol>
      </div>

      {/* ── Typo ───────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Typographie" subtitle="Geist Sans (texte) + Geist Mono (raccourcis, IDs, valeurs hex)." />
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-6">
          {TYPE_SCALE.map((row) => (
            <div key={row.token} className="flex items-baseline gap-4">
              <code className="w-24 shrink-0 text-[11px] text-gray-400 font-mono">{row.token}</code>
              <span className={`${row.token} ${["text-2xl", "text-3xl"].includes(row.token) ? "font-semibold tracking-tight" : ""}`}>{row.sample}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm">
          <p className="font-mono text-gray-500 mb-2 text-[11px]">font-mono</p>
          <p className="font-mono">const handle = &quot;@lola_caupert&quot;;</p>
        </div>
      </section>

      {/* ── Palette monochrome ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Palette monochrome"
          subtitle="L'ossature visuelle de l'app. 95% de l'UI est ici."
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
          subtitle="Statuts uniquement. Jamais des CTA, jamais de la décoration."
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

      {/* ── Brand chirurgical ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Brand"
          subtitle="Orange signature. Réservé au logo Toolbox et 1 dot indicateur dans la nav. Toute autre apparition est une violation de doctrine."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-6">
            {(["50", "100", "500", "600", "700", "900"] as const).map((stop) => (
              <div
                key={stop}
                className={`rounded-md px-3 py-3 text-[11px] font-mono bg-brand-${stop} ${["500", "600", "700", "900"].includes(stop) ? "text-white" : "text-gray-700"}`}
              >
                {stop}
              </div>
            ))}
          </div>
        </div>

        {/* Exemples d'usage légitimes — strictement 2 */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">
            Usages légitimes (les seuls)
          </p>

          {/* Logo */}
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <span className="h-8 w-8 rounded-md bg-brand-600 inline-flex items-center justify-center text-white text-[13px] font-bold">T</span>
            <div className="space-y-0">
              <p className="font-hand text-2xl text-gray-950 leading-none">Toolbox</p>
              <p className="text-[10px] text-gray-400 mt-1">Logo signature · 1 endroit dans l&apos;app (carré brand + nom hand)</p>
            </div>
          </div>

          {/* Dot indicateur nav */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-50">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-brand-600" />
                <span className="absolute inset-0 rounded-full bg-brand-600 animate-ping opacity-50" />
              </span>
              <span className="text-[13px] font-medium text-gray-950">Notifications</span>
              <span className="text-[10px] text-gray-400">3</span>
            </div>
            <p className="text-[10px] text-gray-400">Dot indicateur · 1 endroit dans l&apos;app (nav)</p>
          </div>
        </div>
      </section>

      {/* ── États UI ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="États UI"
          subtitle="Patterns uniformisés à appliquer partout."
        />

        {/* Focus ring */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Focus ring · classe utility</p>
          <div className="flex flex-wrap items-center gap-4">
            <button className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-800 focus-ring transition-colors hover:bg-gray-50">
              Tab pour focus
            </button>
            <input
              type="text"
              placeholder="Tab pour focus"
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-[13px] focus-ring"
            />
            <input
              type="text"
              placeholder="Erreur"
              className="rounded-md border border-danger-600 px-2.5 py-1.5 text-[13px] focus-ring-danger"
            />
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            <code className="font-mono">focus-ring</code> = mono dark partout.
            <code className="font-mono ml-1">focus-ring-danger</code> sur les inputs en erreur.
          </p>
        </div>

        {/* Sélection mono */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Sélection · état actif</p>
          <p className="text-[12px] text-gray-600 leading-relaxed max-w-prose">
            Toujours <strong className="text-gray-950">mono dark</strong> (gray-950). Jamais coloré.
          </p>
          <div className="rounded-md border border-gray-200 bg-gray-50/40 p-2 max-w-sm space-y-1">
            {["Calques", "Formulaire", "Séquence", "Musique"].map((item, i) => (
              <div
                key={item}
                className={`rounded-md px-3 py-1.5 text-[13px] flex items-center justify-between transition-colors ${
                  i === 2 ? "bg-gray-950 text-white" : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span>{item}</span>
                {i === 2 && <span className="text-[10px] uppercase tracking-widest opacity-60">Sélectionné</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Disabled / loading */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Désactivé · chargement</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled
              className="rounded-md bg-gray-950 px-3 py-1.5 text-[13px] font-medium text-white opacity-50 cursor-not-allowed"
            >
              Disabled
            </button>
            <button className="rounded-md bg-gray-950 px-3 py-1.5 text-[13px] font-medium text-white opacity-70 cursor-wait inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Chargement
            </button>
          </div>
        </div>

        {/* Hover lift */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Hover lift (cards interactives)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Module A", "Module B", "Module C"].map((m) => (
              <div
                key={m}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
              >
                <p className="text-[13px] font-medium text-gray-950">{m}</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Subtil. Pas de couleur, juste l&apos;élévation.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Spacing ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Espacements" subtitle="Échelle 4px Tailwind. Privilégier 4/6/8/10/12/16 pour cohérence." />
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
        <SectionHeading title="Border-radius" subtitle="Sharp, précis." />
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
        <SectionHeading title="Ombres" subtitle="Élévation sobre. Overlays uniquement." />
        <div className="grid gap-4 sm:grid-cols-3">
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
          subtitle="Easing unique cubic-bezier(0.16, 1, 0.3, 1). Opacity/scale > slide. Jamais de bounce."
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
            <p className="text-[11px] text-gray-500">Survol la pastille pour voir l&apos;easing :</p>
            <div className="group inline-block">
              <div className="h-10 w-10 rounded-md bg-gray-900 transition-transform duration-200 group-hover:scale-110 group-hover:rounded-xl" />
            </div>
          </div>
        </div>
      </section>
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
