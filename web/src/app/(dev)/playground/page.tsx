/**
 * Playground landing — placeholder pendant la refonte Liquid Glass.
 *
 * Phase 0 (cleanup) : table rase du playground v1 mono-dark.
 * Les vues foundations / atoms / molecules / patterns / vibes seront
 * reconstruites en Phase 5 sur la DA Liquid Glass + palette Coastal Studio.
 */
export default function PlaygroundIndexPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-gray-400 font-medium">
          Playground · Liquid Glass
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          En construction
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          Le nouveau playground Liquid Glass est en cours de construction.
          Les vues <em>foundations</em>, <em>atoms</em>, <em>molecules</em>,
          <em> patterns</em> et <em>vibes</em> seront reconstruites au fil
          de la refonte design system.
        </p>
      </header>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-2">
          Doctrine
        </p>
        <ul className="space-y-1.5 text-[13px] text-gray-700 leading-relaxed">
          <li>Liquid Glass = matière de surface opt-in (variants glass / tinted).</li>
          <li>Ossature structurelle Linear conservée (density, mono CTA, accents sémantiques).</li>
          <li>Palette Coastal Studio (peach, sage, sky, rose-dust) en pastel orchestré.</li>
          <li>Brand orange <code className="text-[12px] font-mono">#FF5A1F</code> chirurgical conservé.</li>
        </ul>
      </div>
    </div>
  );
}
