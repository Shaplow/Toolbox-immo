/**
 * Foundations — vitrine des tokens Liquid Glass (Phase 1).
 *
 * Validation visuelle : palette Coastal Studio + surfaces glass + blur +
 * shadows verrerie + scrims + gradients washes. Tous les tokens utilisés
 * sortent directement de `web/src/app/globals.css` (@theme inline).
 */

// ────────────────────────────────────────────────────────────────────────────
// Helpers locaux
// ────────────────────────────────────────────────────────────────────────────

function SectionHeader({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description: string }) {
  return (
    <header id={id} className="space-y-2 scroll-mt-20">
      <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h2>
      <p className="text-[13px] text-gray-600 max-w-2xl leading-relaxed">{description}</p>
    </header>
  );
}

function Swatch({ label, hex, className, dark = false }: { label: string; hex: string; className: string; dark?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className={`h-14 rounded-lg shadow-[var(--ring-glass-edge)] ${className}`} />
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-medium ${dark ? "text-white" : "text-gray-950"}`}>{label}</span>
        <span className={`text-[10px] font-mono ${dark ? "text-gray-300" : "text-gray-500"}`}>{hex}</span>
      </div>
    </div>
  );
}

function TokenRow({ name, preview, note }: { name: string; preview: React.ReactNode; note?: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr_auto] items-center gap-4 py-3 border-b border-white/30">
      <code className="text-[11px] font-mono text-gray-700">{name}</code>
      <div>{preview}</div>
      {note && <span className="text-[11px] text-gray-500 text-right max-w-[180px]">{note}</span>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sections
// ────────────────────────────────────────────────────────────────────────────

function PaletteSection() {
  const families = [
    {
      name: "Peach",
      tagline: "Chaleur · statuts à faire",
      stops: [
        { label: "50",  hex: "#fff5ed", cls: "bg-peach-50" },
        { label: "100", hex: "#ffe6d0", cls: "bg-peach-100" },
        { label: "200", hex: "#ffd0a8", cls: "bg-peach-200" },
        { label: "500", hex: "#f59e6b", cls: "bg-peach-500" },
        { label: "700", hex: "#b9560a", cls: "bg-peach-700" },
      ],
    },
    {
      name: "Sage",
      tagline: "Calme · statuts ok doux",
      stops: [
        { label: "50",  hex: "#f1f7f2", cls: "bg-sage-50" },
        { label: "100", hex: "#dceee0", cls: "bg-sage-100" },
        { label: "200", hex: "#b9dcc1", cls: "bg-sage-200" },
        { label: "500", hex: "#6fa280", cls: "bg-sage-500" },
        { label: "700", hex: "#2f5f3f", cls: "bg-sage-700" },
      ],
    },
    {
      name: "Sky",
      tagline: "Info · planning · programmé",
      stops: [
        { label: "50",  hex: "#eff6fb", cls: "bg-sky-50" },
        { label: "100", hex: "#d4e8f3", cls: "bg-sky-100" },
        { label: "200", hex: "#a9d1e6", cls: "bg-sky-200" },
        { label: "500", hex: "#4d96bf", cls: "bg-sky-500" },
        { label: "700", hex: "#1f5d7d", cls: "bg-sky-700" },
      ],
    },
    {
      name: "Rose-dust",
      tagline: "Accent rare · signature",
      stops: [
        { label: "50",  hex: "#fdf2f4", cls: "bg-rose-50" },
        { label: "100", hex: "#f7dde2", cls: "bg-rose-100" },
        { label: "200", hex: "#ecbac4", cls: "bg-rose-200" },
        { label: "500", hex: "#c97185", cls: "bg-rose-500" },
        { label: "700", hex: "#863346", cls: "bg-rose-700" },
      ],
    },
  ];

  return (
    <section className="space-y-6">
      <SectionHeader
        id="palette"
        eyebrow="Coastal Studio"
        title="Palette pastel orchestrée"
        description="4 familles à saturation basse. Utilisées en tinted backgrounds, accents de statut doux, dégradés washes. Jamais en CTA, jamais en focus ring."
      />
      <div className="space-y-6">
        {families.map((fam) => (
          <div key={fam.name} className="space-y-2">
            <div className="flex items-baseline gap-3">
              <h3 className="text-[15px] font-semibold text-gray-950">{fam.name}</h3>
              <span className="text-[11px] text-gray-500">{fam.tagline}</span>
            </div>
            <div className="grid grid-cols-5 gap-3">
              {fam.stops.map((s) => (
                <Swatch key={s.label} label={s.label} hex={s.hex} className={s.cls} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SurfacesSection() {
  return (
    <section className="space-y-6">
      <SectionHeader
        id="surfaces"
        eyebrow="Liquid Glass"
        title="Surfaces glass"
        description="4 niveaux d'opacité (strong 0.85 → faint 0.25). Posés sur le wash aurora du layout pour mettre en évidence la matière verre."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { name: "surface-glass-strong", desc: "0.85 alpha · popovers, modals", cls: "bg-[var(--surface-glass-strong)]" },
          { name: "surface-glass-medium", desc: "0.65 alpha · headers sticky", cls: "bg-[var(--surface-glass-medium)]" },
          { name: "surface-glass-soft",   desc: "0.45 alpha · sections internes", cls: "bg-[var(--surface-glass-soft)]" },
          { name: "surface-glass-faint",  desc: "0.25 alpha · accents subtils",   cls: "bg-[var(--surface-glass-faint)]" },
        ].map((s) => (
          <div key={s.name} className="space-y-2">
            <div className={`h-28 rounded-xl ${s.cls} backdrop-blur-[20px] backdrop-saturate-150 shadow-[var(--ring-glass-inset)] flex items-end p-3`}>
              <span className="text-[10px] font-mono text-gray-700">{s.name}</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        <h3 className="text-[13px] font-semibold text-gray-950">Classes utilitaires</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="surface-glass rounded-xl p-5">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1">classe</p>
            <code className="text-[13px] font-mono text-gray-950">.surface-glass</code>
            <p className="text-[11px] text-gray-600 mt-2">strong + blur-md + saturate + shadow-glass-md + ring-inset</p>
          </div>
          <div className="surface-glass-soft rounded-xl p-5">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1">classe</p>
            <code className="text-[13px] font-mono text-gray-950">.surface-glass-soft</code>
            <p className="text-[11px] text-gray-600 mt-2">medium + blur-sm + saturate + shadow-glass-sm + ring-edge</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function BlurSection() {
  return (
    <section className="space-y-6">
      <SectionHeader
        id="blur"
        eyebrow="Backdrop"
        title="Blur intensity"
        description="4 niveaux + saturate 140%. Posés sur une image colorée pour observer l'effet du blur."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { name: "blur-xs", value: "8px", cls: "backdrop-blur-[8px]" },
          { name: "blur-sm", value: "12px", cls: "backdrop-blur-[12px]" },
          { name: "blur-md", value: "20px", cls: "backdrop-blur-[20px]" },
          { name: "blur-lg", value: "32px", cls: "backdrop-blur-[32px]" },
        ].map((b) => (
          <div
            key={b.name}
            className="relative h-28 rounded-xl overflow-hidden"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #f59e6b 0%, #c97185 35%, #4d96bf 70%, #6fa280 100%)",
            }}
          >
            <div className={`absolute inset-0 ${b.cls} backdrop-saturate-150 bg-white/40 flex flex-col justify-end p-3`}>
              <code className="text-[10px] font-mono text-gray-950">--backdrop-{b.name}</code>
              <span className="text-[10px] text-gray-700">{b.value}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShadowsSection() {
  return (
    <section className="space-y-6">
      <SectionHeader
        id="shadows"
        eyebrow="Élévation"
        title="Shadows verrerie"
        description="Combinaison ring intérieur (inset white) + ombre extérieure diffuse + ombre proche subtle. Donne la sensation d'épaisseur de verre."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TokenShadowBox name="shadow-glass-sm" />
        <TokenShadowBox name="shadow-glass-md" />
        <TokenShadowBox name="shadow-glass-lg" />
        <TokenShadowBox name="shadow-glass-popover" />
      </div>
    </section>
  );
}

function TokenShadowBox({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-24 rounded-xl bg-white"
        style={{ boxShadow: `var(--${name})` }}
      />
      <code className="text-[10px] font-mono text-gray-700">{name}</code>
    </div>
  );
}

function ScrimsSection() {
  return (
    <section className="space-y-6">
      <SectionHeader
        id="scrims"
        eyebrow="Backdrops"
        title="Scrims (overlays modal/drawer)"
        description="Fond sombre/clair sous les surfaces flottantes. Le scrim-dark est le défaut pour ConfirmDialog. Le scrim-light est utile sur fond déjà clair."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { name: "scrim-light", desc: "0.65α blanc · sur fonds sombres", cls: "bg-[var(--scrim-light)]" },
          { name: "scrim-dark",  desc: "0.45α noir · défaut modals",       cls: "bg-[var(--scrim-dark)]" },
          { name: "scrim-deep",  desc: "0.65α noir · focus fort",          cls: "bg-[var(--scrim-deep)]" },
        ].map((s) => (
          <div key={s.name} className="space-y-2">
            <div
              className="relative h-28 rounded-xl overflow-hidden"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #f59e6b 0%, #c97185 35%, #4d96bf 70%, #6fa280 100%)",
              }}
            >
              <div className={`absolute inset-0 ${s.cls} flex items-center justify-center`}>
                <code className="text-[11px] font-mono text-white drop-shadow-sm">{s.name}</code>
              </div>
            </div>
            <p className="text-[11px] text-gray-600 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GradientsSection() {
  return (
    <section className="space-y-6">
      <SectionHeader
        id="gradients"
        eyebrow="Washes"
        title="Gradients signature"
        description="Dégradés très subtils pour les backgrounds décoratifs. Aurora = signature du layout playground. Jamais utilisés en CTA."
      />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { name: "gradient-peach-soft", style: "linear-gradient(135deg, rgba(255,230,208,0.45), rgba(255,245,237,0.15))" },
          { name: "gradient-sage-soft",  style: "linear-gradient(135deg, rgba(220,238,224,0.45), rgba(241,247,242,0.15))" },
          { name: "gradient-sky-soft",   style: "linear-gradient(135deg, rgba(212,232,243,0.45), rgba(239,246,251,0.15))" },
          { name: "gradient-frosted",    style: "linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.45))" },
          { name: "gradient-aurora",     style: "linear-gradient(135deg, rgba(255,230,208,0.35), rgba(220,238,224,0.25) 50%, rgba(212,232,243,0.35))" },
        ].map((g) => (
          <div key={g.name} className="flex flex-col gap-2">
            <div
              className="h-24 rounded-xl shadow-[var(--ring-glass-edge)]"
              style={{ background: g.style }}
            />
            <code className="text-[10px] font-mono text-gray-700">{g.name}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

export default function FoundationsPage() {
  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 1 · Foundations
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          Tokens Liquid Glass
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          Tout le vocabulaire glass centralisé dans <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">web/src/app/globals.css</code>.
          Cette page sert de référence visuelle pour la palette Coastal Studio,
          les surfaces glass, le blur, les shadows verrerie, les scrims et les
          gradients washes.
        </p>
      </header>

      <PaletteSection />
      <SurfacesSection />
      <BlurSection />
      <ShadowsSection />
      <ScrimsSection />
      <GradientsSection />

      {/* Note pied de page */}
      <div className="surface-glass-soft rounded-xl p-5 mt-12">
        <p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mb-2">
          Phase suivante
        </p>
        <p className="text-[13px] text-gray-700 leading-relaxed">
          Voir <a className="text-gray-950 font-medium hover:underline" href="/playground/atoms">/playground/atoms</a> pour les 22 primitives avec leurs nouveaux variants
          <code className="text-[11px] font-mono mx-1">glass</code> / <code className="text-[11px] font-mono">tinted</code>.
        </p>
      </div>
    </div>
  );
}
