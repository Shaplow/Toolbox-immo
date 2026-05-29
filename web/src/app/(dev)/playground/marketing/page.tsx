/**
 * Page Marketing — tokens éditoriaux strictement réservés aux landing pages.
 *
 * Violation de doctrine : si tu utilises `font-serif`, `font-hand`, `HandDrawn`,
 * les gradients ou la grain texture dans un fichier de
 * `app/(app|admin)/*` ou `components/(builder|calendar|publications|admin)/*`,
 * rollback.
 *
 * Voir `web/docs/design-system.md` § "Tokens MARKETING ONLY".
 */

import { HandDrawn } from "@/components/ui/decor/HandDrawn";
import { PageHeader } from "../_components/PageHeader";
import { ComponentDoc } from "../_components/ComponentDoc";
import { PreviewCanvas } from "../_components/PreviewCanvas";
import { VariantBlock } from "../_components/VariantBlock";

export default function MarketingPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Tokens éditoriaux"
        description={
          <>
            Réservés aux futures landing pages et hero éditoriaux.{" "}
            <strong className="text-gray-950 font-semibold">
              Aucun de ces tokens n’est utilisable dans l’UI d’équipe
            </strong>{" "}
            (dashboards, panneaux, fiches, formulaires).{" "}
            <a href="/playground/tokens" className="underline underline-offset-2 hover:text-gray-950">
              Voir les tokens UI →
            </a>
          </>
        }
      />

      {/* Garde-fou — version sobre, mono dark */}
      <div className="mb-12 rounded-lg border border-gray-200 bg-gray-50/60 p-5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-950 text-white text-[10px] font-mono">
            !
          </span>
          <div className="space-y-2">
            <p className="text-[12px] text-gray-700 leading-relaxed">
              <strong className="text-gray-950">Discipline.</strong> Si tu vois{" "}
              <Token>font-serif</Token>, <Token>font-hand</Token>,{" "}
              <Token>bg-[var(--gradient-hero)]</Token>, <Token>&lt;HandDrawn.* /&gt;</Token>{" "}
              dans un fichier de l’app courante → rollback.
            </p>
            <p className="text-[11px] text-gray-500">
              Périmètre autorisé : <code className="font-mono text-gray-700">/landing</code>,{" "}
              <code className="font-mono text-gray-700">/about</code>,{" "}
              <code className="font-mono text-gray-700">/careers</code> (futures).
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <ComponentDoc
          id="typography"
          title="Typographies éditoriales"
          meta={["Instrument Serif", "Caveat"]}
          description="Réservées aux hero pages, pull quotes, signatures."
        >
          <VariantBlock label="Instrument Serif italic" description="Hero titles et pull quotes uniquement. Jamais en body, jamais en UI.">
            <PreviewCanvas align="start" padding="loose">
              <h3 className="font-serif italic text-4xl sm:text-5xl tracking-tight text-gray-950 leading-[1.05]">
                Vos publications,
                <br />
                du shoot au feed.
              </h3>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Caveat (signature)" description="Signature de citation, eyebrow signature, légendes moodboard.">
            <PreviewCanvas align="start" padding="loose">
              <p className="font-hand text-3xl text-gray-950 leading-none">— Léa Vasseur</p>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="hero"
          title="Hero pattern"
          meta={["gradient-hero", "texture-grain", "font-serif"]}
          description="Gradient brand subtil + grain texture + serif italic + CTA brand. Pour landing pages uniquement."
        >
          <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-[var(--gradient-hero)] p-10 sm:p-14">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-50 mix-blend-multiply"
              style={{ backgroundImage: "var(--texture-grain)" }}
            />
            <div className="relative max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.16em] text-brand-700 font-medium inline-flex items-center gap-1.5">
                <HandDrawn.Sparkle className="h-2.5 w-2.5" />
                Nouveau · Mise à jour
              </p>
              <h3 className="mt-3 font-serif italic text-4xl sm:text-5xl tracking-tight text-gray-950 leading-[1.05]">
                Vos publications,
                <br />
                du shoot au feed.
              </h3>
              <p className="mt-4 text-sm text-gray-600 leading-relaxed">
                Une régie éditoriale qui orchestre vos comptes, vos équipes et
                vos contenus. Pensée pour les agences qui voient grand.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button className="rounded-md bg-brand-600 hover:bg-brand-700 px-4 py-2 text-[13px] font-medium text-white transition-colors">
                  Demander une démo
                </button>
                <button className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] font-medium text-gray-800 hover:bg-gray-50 transition-colors">
                  En savoir plus
                </button>
              </div>
            </div>
          </div>
        </ComponentDoc>

        <ComponentDoc
          id="pull-quote"
          title="Pull quote"
          meta={["serif italic", "signature hand", "HandDrawn.WavyRule"]}
          description="Citation client. Underline brand sur 1 mot clé, signature hand, légende uppercase."
        >
          <PreviewCanvas align="center" padding="loose" bg="plain">
            <div className="max-w-2xl mx-auto text-center space-y-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400 inline-flex items-center gap-1.5">
                <HandDrawn.Sparkle className="h-3 w-3 text-brand-700" />
                Ce qu’en disent nos clients
              </p>
              <p className="font-serif italic text-2xl sm:text-3xl leading-relaxed text-gray-950">
                « Avant Toolbox, on perdait des heures à coordonner. Maintenant on{" "}
                <span className="relative inline-block">
                  crée
                  <HandDrawn.Underline className="absolute -bottom-1.5 left-0 h-2 w-full text-brand-700" />
                </span>
                , ils diffusent. »
              </p>
              <HandDrawn.WavyRule className="h-2 w-32 mx-auto text-gray-300" />
              <div className="space-y-1.5">
                <p className="font-hand text-2xl text-gray-950 leading-none">— Léa Vasseur</p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">
                  Directrice · Studio La Mira
                </p>
              </div>
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="decorations"
          title="Décors signature"
          meta={["HandDrawn.Sparkle", "Arrow", "Underline", "WavyRule", "Check"]}
          description="Sparkle + Arrow tolérés en UI signature très ponctuelle. Underline + WavyRule sont strictement éditoriaux."
        >
          <VariantBlock label="UI signature (tolérés en SaaS sur micro-spots)">
            <PreviewCanvas align="center" padding="loose">
              <div className="flex flex-wrap items-center gap-8">
                <div className="text-center space-y-1.5">
                  <HandDrawn.Sparkle className="h-6 w-6 text-brand-700 mx-auto" />
                  <code className="text-[10px] font-mono text-gray-400 block">Sparkle</code>
                </div>
                <div className="text-center space-y-1.5">
                  <HandDrawn.Arrow className="h-3 w-12 text-gray-700 mx-auto" />
                  <code className="text-[10px] font-mono text-gray-400 block">Arrow</code>
                </div>
                <div className="text-center space-y-1.5">
                  <HandDrawn.Check className="h-6 w-6 text-gray-950 mx-auto" />
                  <code className="text-[10px] font-mono text-gray-400 block">Check</code>
                </div>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Éditorial strict (landing only)">
            <PreviewCanvas align="center" padding="loose">
              <div className="flex flex-wrap items-center gap-12">
                <div className="text-center space-y-2">
                  <div className="relative inline-block">
                    <span className="font-serif italic text-xl text-gray-950">souligné</span>
                    <HandDrawn.Underline className="absolute -bottom-1.5 left-0 h-2 w-full text-brand-700" />
                  </div>
                  <code className="text-[10px] font-mono text-gray-400 block">Underline</code>
                </div>
                <div className="text-center space-y-2">
                  <HandDrawn.WavyRule className="h-2 w-32 text-gray-400" />
                  <code className="text-[10px] font-mono text-gray-400 block">WavyRule</code>
                </div>
              </div>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>
      </div>
    </div>
  );
}

function Token({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white border border-gray-200 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
      {children}
    </code>
  );
}
