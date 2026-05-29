import Link from "next/link";
import { ArrowRight, Palette, Layers, Boxes, Sparkles, FlaskConical } from "lucide-react";

/**
 * Playground landing — hub Liquid Glass.
 *
 * Phase 1+2 livrées : tokens + 22 primitives.
 * Phase 3 en cours : 16 atomes nouveaux par lots.
 */

const SECTIONS = [
  {
    href: "/playground/foundations",
    eyebrow: "Phase 1 · Foundations",
    icon: Palette,
    title: "Tokens Liquid Glass",
    description: "Palette Coastal Studio (peach, sage, sky, rose-dust), surfaces glass, backdrop blur, shadows verrerie, scrims et gradients washes. Référence visuelle des tokens dans globals.css.",
    status: "Livré",
  },
  {
    href: "/playground/atoms",
    eyebrow: "Phase 2 · Atoms",
    icon: Boxes,
    title: "22 primitives",
    description: "Variants glass / tinted opt-in (Phase 2A) sur Button, ButtonIcon, Card, Badge, Input, Textarea, Select, Tabs, Switch, Slider. Migrations internes (Phase 2B) sur Tooltip, DropdownMenu, ConfirmDialog, Toast, Skeleton, Kbd, EmptyState, MediaDropzone, CollapsibleSection.",
    status: "Livré",
  },
  {
    href: "/playground/atoms-new",
    eyebrow: "Phase 3 · Atomes nouveaux",
    icon: Layers,
    title: "16 atomes nouveaux",
    description: "Overlays (Modal/Drawer/Sheet + useDialogStack), atomes visuels (Avatar/Alert/Progress), inputs avancés (Chip/Breadcrumb/Stepper/Combobox/CommandPalette via cmdk), data+temps (Table/Pagination/DatePicker/TimePicker/NumberStepper avec calendrier et sélecteur d'heure custom Liquid Glass).",
    status: "Livré",
  },
  {
    href: "/playground/molecules",
    eyebrow: "Phase 4 · Molécules métier",
    icon: Sparkles,
    title: "Lot 1 — Section + SoftPanel + EmptyHero + StatusBadge",
    description: "Wrappers factorisés (Section pour les sections fiche pub, SoftPanel pour pages d'édition longues), empty hero page-level avec halo signature, status badges centralisés via lib/ui/statusMapping (render/caption/description/cover/slot/transcription). Lots suivants : Média (VideoPlayer/AssetCard) puis Édition puis Métier.",
    status: "Lot 1 livré",
  },
];

const UPCOMING = [
  { icon: FlaskConical,  label: "Phases 5+ · Patterns + vibes + refonte modules", description: "Playground neuf (foundations/atoms/molecules/patterns/vibes) + refonte module par module (Coquille → Fiche → Drawer → Calendar → Home → Admin → Builder → Tools)" },
];

const DOCTRINE = [
  "Glass = matière flottante (popovers, modals, headers sticky, drawers). Jamais en grille dense ni en CTA.",
  "Coastal Studio = palette pastel orchestrée pour tinted backgrounds et accents doux. Jamais en CTA, jamais en focus ring.",
  "Brand orange #FF5A1F reste chirurgical : logo + dot notif. C'est sa rareté qui le rend mémorable.",
  "Extension de la doctrine v1 (Linear / mono CTA gray-950 / accents sémantiques) — pas remplacement.",
];

export default function PlaygroundIndexPage() {
  return (
    <div className="space-y-14 max-w-4xl">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <header className="space-y-4">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Playground · Liquid Glass v2
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-gray-950">
          Toolbox Immo — Design System
        </h1>
        <p className="text-[15px] text-gray-700 max-w-2xl leading-relaxed">
          Sandbox interne pour valider la refonte Liquid Glass phase par phase.
          Tokens, primitives, molécules, patterns — chaque livraison passe par
          ici avant migration des surfaces métier.
        </p>
      </header>

      {/* ── Sections livrées ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <header className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">Vitrines</p>
          <h2 className="text-xl font-semibold tracking-tight text-gray-950">Livré · validable maintenant</h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="group surface-glass rounded-xl p-6 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-glass-md),var(--ring-glass-inset)]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-10 w-10 rounded-lg bg-white/80 backdrop-blur-[8px] shadow-[var(--ring-glass-inset)] flex items-center justify-center text-gray-800">
                    <Icon size={18} />
                  </div>
                  <span className="rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-medium text-sage-700 shadow-[var(--ring-glass-edge)]">
                    {s.status}
                  </span>
                </div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1">{s.eyebrow}</p>
                <h3 className="text-[17px] font-semibold tracking-tight text-gray-950 mb-2">{s.title}</h3>
                <p className="text-[12px] text-gray-600 leading-relaxed">{s.description}</p>
                <div className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-gray-950 group-hover:gap-2 transition-all">
                  Voir
                  <ArrowRight size={12} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Doctrine ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <header className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">Doctrine</p>
          <h2 className="text-xl font-semibold tracking-tight text-gray-950">4 règles cardinales</h2>
        </header>
        <ol className="surface-glass-soft rounded-xl p-6 space-y-3">
          {DOCTRINE.map((rule, i) => (
            <li key={i} className="flex items-start gap-3 text-[13px] text-gray-700 leading-relaxed">
              <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-md bg-white/70 backdrop-blur-[6px] shadow-[var(--ring-glass-edge)] text-[10px] font-mono font-medium text-gray-700 mt-0.5">
                {i + 1}
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Upcoming ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <header className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">Roadmap</p>
          <h2 className="text-xl font-semibold tracking-tight text-gray-950">À venir</h2>
        </header>
        <div className="space-y-3">
          {UPCOMING.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.label} className="surface-glass-soft rounded-xl p-4 flex items-start gap-4">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-white/70 backdrop-blur-[6px] shadow-[var(--ring-glass-edge)] flex items-center justify-center text-gray-600">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-950">{p.label}</p>
                  <p className="text-[12px] text-gray-600 mt-0.5 leading-relaxed">{p.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
