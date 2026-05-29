type FamilyHeadingProps = {
  label: string;
  description?: string;
};

/**
 * Séparateur de famille (Actions, Forms, Feedback, etc.) entre les groupes
 * de composants. Crée un rythme visuel au-dessus des fiches ComponentDoc.
 */
export function FamilyHeading({ label, description }: FamilyHeadingProps) {
  return (
    <div className="pt-12 first:pt-0 pb-2">
      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
        {label}
      </p>
      {description ? (
        <p className="text-[13px] text-gray-400 mt-1">{description}</p>
      ) : null}
    </div>
  );
}
