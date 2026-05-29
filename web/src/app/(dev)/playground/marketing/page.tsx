/**
 * Sandbox tokens MARKETING ONLY.
 *
 * Tout ce qui est ici (serif éditoriale, hand signature, décors,
 * gradient hero, grain texture) est strictement réservé aux landing
 * pages futures et aux pages éditoriales hors UI d'équipe.
 *
 * Violation de doctrine = si tu utilises font-serif, font-hand,
 * HandDrawn ou les gradients/grain dans un fichier de
 * `app/(app|admin)/*` ou `components/(builder|calendar|publications|admin)/*`,
 * rollback.
 *
 * Voir `web/docs/design-system.md` § "Tokens MARKETING ONLY".
 */

import { HandDrawn } from "@/components/ui/decor/HandDrawn";

export default function MarketingPage() {
  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Tokens marketing</h1>
        <p className="max-w-prose text-sm text-gray-500">
          Sandbox pour les futures landing pages et hero éditoriaux.{" "}
          <strong className="text-gray-950">Aucun de ces tokens n&apos;est utilisable dans l&apos;UI d&apos;équipe</strong>
          {" "}(dashboards, panneaux, fiches, formulaires). Pour les tokens UI,
          voir <a href="/playground/tokens" className="underline hover:text-gray-950">/playground/tokens</a>.
        </p>
      </header>

      {/* Warning bandeau */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[12px] text-amber-900 leading-relaxed">
        <strong>Discipline :</strong> si tu vois <code className="font-mono bg-amber-100 px-1 rounded">font-serif</code>,{" "}
        <code className="font-mono bg-amber-100 px-1 rounded">font-hand</code>,{" "}
        <code className="font-mono bg-amber-100 px-1 rounded">bg-[var(--gradient-hero)]</code>,{" "}
        <code className="font-mono bg-amber-100 px-1 rounded">{`<HandDrawn.* />`}</code>{" "}
        dans un fichier de l&apos;app courante → rollback. Ces tokens ne servent
        QUE pour /landing, /about, /careers (futures).
      </div>

      {/* ── Typo marketing ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Typographies éditoriales" subtitle="Réservées aux hero pages, pull quotes, signatures." />
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Instrument Serif italic</p>
            <h3 className="font-serif italic text-4xl tracking-tight text-gray-950 leading-[1.05]">
              Vos publications,<br />du shoot au feed.
            </h3>
            <p className="text-[11px] text-gray-500">
              Pour hero titles et pull quotes uniquement. Jamais en body, jamais en UI.
            </p>
          </div>
          <div className="border-t border-gray-200 pt-5 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Caveat (signature)</p>
            <p className="font-hand text-3xl text-gray-950 leading-none">— Léa Vasseur</p>
            <p className="text-[11px] text-gray-500">
              Signature de citation, eyebrow signature, légendes de moodboard.
            </p>
          </div>
        </div>
      </section>

      {/* ── Hero pattern ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading title="Hero pattern" subtitle="Gradient brand subtil + grain texture + serif italic + CTA brand." />
        <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-[var(--gradient-hero)] p-10 sm:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
            style={{ backgroundImage: "var(--texture-grain)" }}
          />
          <div className="relative">
            <p className="text-[11px] uppercase tracking-widest text-brand-700 font-medium inline-flex items-center gap-1.5">
              <HandDrawn.Sparkle className="h-2.5 w-2.5" />
              Nouveau · Mise à jour
            </p>
            <h3 className="mt-3 font-serif italic text-4xl sm:text-5xl tracking-tight text-gray-950 leading-[1.05]">
              Vos publications,<br />du shoot au feed.
            </h3>
            <p className="mt-4 max-w-xl text-sm text-gray-600 leading-relaxed">
              Une régie éditoriale qui orchestre vos comptes, vos équipes et
              vos contenus. Pensée pour les agences qui voient grand.
            </p>
          </div>
        </div>
      </section>

      {/* ── Décors HandDrawn ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Décors signature"
          subtitle="Sparkle + Arrow (UI signature) · Underline + WavyRule (éditorial strict)."
        />
        <div className="rounded-lg border border-gray-200 bg-white p-10 sm:p-14">
          <div className="max-w-2xl mx-auto text-center space-y-5">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 inline-flex items-center gap-1.5">
              <HandDrawn.Sparkle className="h-3 w-3 text-brand-700" />
              Ce qu&apos;en disent nos clients
            </p>
            <p className="font-serif italic text-2xl sm:text-3xl leading-relaxed text-gray-950">
              &ldquo;Avant Toolbox, on perdait des heures à coordonner.
              Maintenant on{" "}
              <span className="relative inline-block">
                crée
                <HandDrawn.Underline className="absolute -bottom-1.5 left-0 h-2 w-full text-brand-700" />
              </span>
              , ils diffusent.&rdquo;
            </p>
            <HandDrawn.WavyRule className="h-2 w-32 mx-auto text-gray-300" />
            <div className="space-y-1.5">
              <p className="font-hand text-2xl text-gray-950 leading-none">— Léa Vasseur</p>
              <p className="text-[11px] uppercase tracking-widest text-gray-400">
                Directrice · Studio La Mira
              </p>
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
