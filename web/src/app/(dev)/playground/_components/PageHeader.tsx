import type { ReactNode } from "react";

type PageHeaderProps = {
  /** Eyebrow contextuel : "Foundations", "Components", "Marketing"… */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
};

/**
 * Header standardisé d'une page playground. Eyebrow contextuel +
 * titre serré + description courte. Ancrage visuel commun à toutes les pages.
 */
export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="space-y-3 pb-10 mb-10 border-b border-gray-100">
      {eyebrow ? (
        <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-medium">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-[28px] font-semibold tracking-tight text-gray-950 leading-tight">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-[14px] text-gray-500 leading-relaxed">{description}</p>
      ) : null}
    </header>
  );
}
