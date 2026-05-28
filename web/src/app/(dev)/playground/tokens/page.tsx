/**
 * Visualisation des tokens du design system (Phase 1).
 *
 * Sert de référence visuelle pour valider la DA avant migration des
 * surfaces. Synchronisé avec `web/src/app/globals.css` et la doc
 * `web/docs/design-system.md`.
 */
import { HandDrawn } from "@/components/ui/decor/HandDrawn";

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

      {/* ── States UI ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="États UI"
          subtitle="Patterns à appliquer uniformément dans tous les composants. La cohérence des états (focus, sélection, disabled, loading, erreur) est ce qui distingue un design system tenu d'un patchwork."
        />

        {/* Focus ring */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Focus ring · classe utility <code className="font-mono text-gray-600">focus-ring</code>
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 focus-ring transition-colors hover:bg-gray-50">
              Tab pour me focus
            </button>
            <input
              type="text"
              placeholder="Tab pour focus"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus-ring"
            />
            <input
              type="text"
              placeholder="Erreur (danger)"
              className="rounded-md border border-danger-600 px-3 py-2 text-sm focus-ring-danger"
            />
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            La classe globale <code className="font-mono">focus-ring</code> applique
            l&apos;anneau brand sur <code className="font-mono">:focus-visible</code>.
            Pour les inputs en erreur, utiliser <code className="font-mono">focus-ring-danger</code>.
          </p>
        </div>

        {/* Sélection mono — IMPORTANT : brand n'est PAS pour la sélection UI */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Sélection · état actif
          </p>
          <p className="text-[12px] text-gray-600 leading-relaxed max-w-prose">
            <strong className="text-gray-950">Le brand n&apos;est PAS la couleur de sélection.</strong>
            {" "}Une nav, une liste, un onglet sélectionné se rend en{" "}
            <strong className="text-gray-950">mono dark</strong> (gray-950 ou
            gray-100). Sinon l&apos;app vire orange-pop. Reserve le brand aux
            CTA primary et highlights marketing.
          </p>
          {/* Sample nav list */}
          <div className="rounded-md border border-gray-200 bg-gray-50/40 p-2 max-w-sm space-y-1">
            {["Calques", "Formulaire", "Séquence", "Musique"].map((item, i) => (
              <div
                key={item}
                className={`rounded-md px-3 py-1.5 text-sm flex items-center justify-between transition-colors ${
                  i === 2
                    ? "bg-gray-950 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span>{item}</span>
                {i === 2 && <span className="text-[10px] uppercase tracking-widest opacity-60">Sélectionné</span>}
              </div>
            ))}
          </div>
          {/* Sample tab */}
          <div className="flex items-center border-b border-gray-200 max-w-md">
            {["Aperçu", "Versions", "Activité"].map((tab, i) => (
              <button
                key={tab}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  i === 0
                    ? "border-gray-950 text-gray-950"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Disabled / Loading */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Désactivé · chargement
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              disabled
              className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              Disabled
            </button>
            <button className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white opacity-70 cursor-wait inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Chargement
            </button>
            <input
              type="text"
              disabled
              placeholder="Input désactivé"
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
            />
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Disabled : <code className="font-mono">opacity-50 cursor-not-allowed</code>.
            Loading : spinner inline + <code className="font-mono">opacity-70</code>.
          </p>
        </div>

        {/* Hover lift */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Hover lift (cards interactives)
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Module A", "Module B", "Module C"].map((m) => (
              <div
                key={m}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
              >
                <p className="text-sm font-medium text-gray-950">{m}</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Subtil. Pas de couleur, juste l&apos;élévation.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Brand & marketing ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Brand & expression marketing"
          subtitle="Une couleur signature (brand) + une serif éditoriale + une texture grain — le côté studio créatif, sans rompre l'épuré."
        />

        {/* Brand color stops */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-3 inline-flex items-center gap-1.5">
            <span className="text-brand-700">✦</span>
            Brand · Orange corail
          </p>
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

        {/* Hero pattern */}
        <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-[var(--gradient-hero)] p-10 sm:p-14">
          {/* Grain noise overlay — texture studio sans casser la lecture */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
            style={{ backgroundImage: "var(--texture-grain)" }}
          />
          <div className="relative">
            <p className="text-[11px] uppercase tracking-widest text-brand-700 font-medium inline-flex items-center gap-1.5">
              <span>✦</span>
              Nouveau · Mise à jour
            </p>
            <h3 className="mt-3 font-serif italic text-4xl sm:text-5xl tracking-tight text-gray-950 leading-[1.05]">
              Vos publications,<br />du shoot au feed.
            </h3>
            <p className="mt-4 max-w-xl text-sm text-gray-600 leading-relaxed">
              Une régie éditoriale qui orchestre vos comptes, vos équipes et
              vos contenus. Pensée pour les agences qui voient grand.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-glow-brand)] transition-all duration-200 hover:bg-brand-700 hover:shadow-[var(--shadow-glow-brand-strong)] hover:-translate-y-0.5"
              >
                Démarrer
              </button>
              <button
                type="button"
                className="rounded-md border border-gray-300 bg-white/70 px-4 py-2 text-sm font-medium text-gray-800 backdrop-blur transition-colors hover:bg-white hover:border-gray-400"
              >
                Voir un exemple →
              </button>
            </div>
          </div>
        </div>

        {/* Card grid avec photos placeholder + hover effect */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Templates", color: "from-blue-400 to-indigo-500" },
            { label: "Cover auto", color: "from-amber-400 to-rose-500" },
            { label: "Captions", color: "from-emerald-400 to-cyan-500" },
          ].map((card) => (
            <div
              key={card.label}
              className="group cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-elevated)] hover:border-gray-300"
            >
              <div className={`aspect-[16/10] bg-gradient-to-br ${card.color} relative`}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              </div>
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Module</p>
                <h4 className="mt-1 font-semibold tracking-tight text-gray-950 group-hover:text-brand-900 transition-colors">
                  {card.label}
                </h4>
                <p className="mt-1 text-xs text-gray-500">
                  Description courte du module — explique en une ligne ce
                  qu&apos;on y fait.
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTAs et liens */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Patterns d&apos;action</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-glow-brand)] transition-all hover:bg-brand-700 hover:shadow-[var(--shadow-glow-brand-strong)]">
              Brand CTA
            </button>
            <button className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800">
              Action principale
            </button>
            <button className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50">
              Secondaire
            </button>
            <button className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100">
              Ghost
            </button>
            <a className="group inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-900">
              Lien narratif
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
          </div>
        </div>

        {/* Eyebrow / display typo */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">Typographie marketing</p>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-widest text-brand-700 font-medium inline-flex items-center gap-1.5">
              <span>✦</span>
              Display serif italique
            </p>
            <h3 className="font-serif italic text-4xl tracking-tight text-gray-950 leading-[1.05]">
              On crée, vous diffusez.
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed max-w-prose">
              La serif italique sur les hero — c&apos;est ce qui dit
              &laquo; studio créatif &raquo;. À garder pour les moments
              clés, jamais pour du body texte.
            </p>
          </div>

          <div className="border-t border-gray-200 pt-5 space-y-1">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">Display sans semibold</p>
            <h3 className="text-3xl font-semibold tracking-tight text-gray-950">
              Pour les titres techniques.
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed max-w-prose">
              Geist Sans semibold pour les sections plus opérationnelles
              (dashboard, fiche publication, panneaux). Plus neutre, plus
              fonctionnel.
            </p>
          </div>

          <div className="border-t border-gray-200 pt-5">
            <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Pull quote serif</p>
            <p className="font-serif italic text-xl text-gray-800 leading-relaxed">
              &ldquo;Une régie qui fait le travail ingrat à votre place,
              sans abandonner les détails qui font la différence.&rdquo;
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-widest text-gray-400">— Pull quote · Hero</p>
          </div>
        </div>
      </section>

      {/* ── Signature handmade ────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Signature handmade · style Excalidraw"
          subtitle="Le 3e registre — caractère agence. Apparitions chirurgicales dans l'app : logo, badges « Astuce », eyebrows, légendes. JAMAIS en body ni UI fonctionnelle."
        />

        {/* Doctrine d'usage des 3 registres typo */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-4">
            Discipline d&apos;usage des 3 registres
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">Tech functional</p>
              <p className="text-2xl font-semibold tracking-tight text-gray-950">Geist Sans</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                UI courante : 90% de l&apos;app. Dashboards, panneaux,
                fiches, formulaires.
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">Marketing editorial</p>
              <p className="font-serif italic text-2xl tracking-tight text-gray-950">Instrument Serif</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Hero titles, pull quotes, landing pages. Studio créatif.
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">Signature handmade</p>
              <p className="font-hand text-3xl text-gray-950">Caveat</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Logo, badges « Astuce », eyebrows, légendes. Touches
                agence ponctuelles.
              </p>
            </div>
          </div>
        </div>

        {/* Décors SVG hand-drawn */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Décors hand-drawn — bibliothèque
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Underline */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Underline</p>
              <p className="text-lg text-gray-950">
                Un mot{" "}
                <span className="relative inline-block">
                  important
                  <HandDrawn.Underline className="absolute -bottom-1.5 left-0 h-2 w-full text-brand-700" />
                </span>{" "}
                à mettre en valeur.
              </p>
            </div>

            {/* Asterisk */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Asterisk</p>
              <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-brand-700 font-medium">
                <HandDrawn.Asterisk className="h-3.5 w-3.5" />
                Nouveau · Astuce
              </p>
            </div>

            {/* Arrow */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Arrow</p>
              <a className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-900 group">
                Voir l&apos;exemple
                <HandDrawn.Arrow className="h-3 w-7 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>

            {/* Highlight circle */}
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Highlight circle</p>
              <p className="text-lg text-gray-950">
                Ton plan{" "}
                <span className="relative inline-block px-1">
                  hebdo
                  <HandDrawn.HighlightCircle className="absolute -inset-x-1 -inset-y-2 text-brand-700 -z-10" />
                </span>{" "}
                est validé.
              </p>
            </div>

            {/* Bracket */}
            <div className="sm:col-span-2">
              <p className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">Bracket</p>
              <p className="inline-flex items-center text-sm text-gray-700">
                <HandDrawn.Bracket side="left" className="h-8 w-4 text-brand-700" />
                <span className="px-1 font-hand text-xl text-brand-700">astuce</span>
                <HandDrawn.Bracket side="right" className="h-8 w-4 text-brand-700" />
                <span className="ml-2">
                  Survol les cards pour voir le lift au hover.
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Patterns concrets : éléments app habillés en signature */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <p className="text-[11px] uppercase tracking-widest text-gray-400">
            Application dans l&apos;app — exemples
          </p>

          {/* Logo agence */}
          <div className="flex items-center gap-4 border-b border-gray-100 pb-5">
            <span className="h-8 w-8 rounded-md bg-gray-950 inline-flex items-center justify-center">
              <HandDrawn.Asterisk className="h-4 w-4 text-brand-500" />
            </span>
            <div>
              <p className="font-hand text-2xl text-gray-950 leading-none">Toolbox</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-400">Régie éditoriale</p>
            </div>
          </div>

          {/* Tip callout */}
          <div className="border-l-2 border-brand-600 bg-brand-50 pl-4 py-3 pr-4 rounded-r-lg">
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-brand-700 font-medium mb-1">
              <HandDrawn.Asterisk className="h-3 w-3" />
              Astuce
            </p>
            <p className="text-sm text-gray-800 leading-relaxed">
              Tu peux dupliquer un slot existant via{" "}
              <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-mono">⌘D</kbd>
              {" "}depuis le calendrier.
            </p>
          </div>

          {/* Empty state friendly */}
          <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center space-y-3">
            <HandDrawn.Asterisk className="h-6 w-6 text-gray-300 mx-auto" />
            <p className="font-hand text-2xl text-gray-700">Aucun slot ici pour l&apos;instant</p>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Crée ton premier slot depuis le calendrier ou attends que la
              prochaine génération hebdo soit lancée.
            </p>
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
