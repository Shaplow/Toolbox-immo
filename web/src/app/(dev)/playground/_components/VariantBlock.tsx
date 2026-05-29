import type { ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";

type VariantBlockProps = {
  label: string;
  description?: string;
  children: ReactNode;
};

/**
 * Sous-bloc d'une fiche ComponentDoc — montre un variant ou une configuration
 * particulière. Eyebrow + description fine, contenu en dessous.
 */
export function VariantBlock({ label, description, children }: VariantBlockProps) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <Eyebrow>{label}</Eyebrow>
        {description ? (
          <p className="text-[12px] text-gray-500 leading-relaxed max-w-prose">{description}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
