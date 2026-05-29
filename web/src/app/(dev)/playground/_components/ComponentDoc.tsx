import type { ReactNode } from "react";

type ComponentDocProps = {
  /** Id pour l'ancre + scrollspy. */
  id: string;
  /** Titre composant. */
  title: string;
  /** 1 phrase synth. */
  description?: string;
  /** Tags rapides (variants, sizes, etc.). */
  meta?: string[];
  children: ReactNode;
};

/**
 * Fiche standardisée pour un composant. Pattern identique sur toute la page
 * pour créer un rythme visuel solide.
 *
 * Structure :
 *   ┌─ titre + meta + description
 *   │
 *   │  [ contenu : PreviewCanvas + VariantBlocks ]
 *   │
 *   └─ separator
 */
export function ComponentDoc({ id, title, description, meta, children }: ComponentDocProps) {
  return (
    <section id={id} className="scroll-mt-24 pb-12 border-b border-gray-100 last:border-b-0">
      <header className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[20px] font-semibold tracking-tight text-gray-950">{title}</h2>
        {meta && meta.length > 0 ? (
          <div className="flex items-center gap-1.5">
            {meta.map((m) => (
              <code
                key={m}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-mono text-gray-600"
              >
                {m}
              </code>
            ))}
          </div>
        ) : null}
        {description ? (
          <p className="w-full text-[13px] text-gray-500 leading-relaxed mt-1.5 max-w-prose">
            {description}
          </p>
        ) : null}
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}
