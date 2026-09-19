/**
 * Le compte d'une publication, et le fait qu'elle parte en collaboration.
 *
 * LE BESOIN : le handle est réécrit à la main sur une quinzaine de surfaces, et
 * aucune ne disait qu'une publication avait des comptes invités. Le CM le
 * découvrait en ouvrant la fiche — or c'est une information de repérage : elle
 * doit se voir depuis la liste, avant d'ouvrir quoi que ce soit.
 *
 * COMPACT PAR CONSTRUCTION : la carte du calendrier fait 56 px depuis la
 * densification I.1, et le nom du compte en a été retiré exprès. L'indication
 * de collaboration tient donc sur la ligne du handle — « @client +2 » — et la
 * liste complète va dans l'attribut `title`, que le composant expose aussi à
 * ses appelants via `accountTitle()` pour les cartes qui composent leur propre
 * infobulle.
 */

interface AccountLabelProps {
  handle: string | null | undefined;
  collabs?: { handle: string }[];
  /** Texte affiché quand la publication n'a pas de compte (mission « stock »). */
  emptyLabel?: string;
  className?: string;
}

/** Le compte et ses collaborateurs, en une ligne — pour un `title` natif. */
export function accountTitle(
  handle: string | null | undefined,
  collabs: { handle: string }[] = [],
  emptyLabel = "Sans compte",
): string {
  if (!handle) return emptyLabel;
  if (collabs.length === 0) return `@${handle}`;
  return `@${handle} — en collaboration avec ${collabs.map((c) => `@${c.handle}`).join(", ")}`;
}

export function AccountLabel({
  handle,
  collabs = [],
  emptyLabel = "Sans compte",
  className = "",
}: AccountLabelProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
      title={accountTitle(handle, collabs, emptyLabel)}
    >
      <span className="truncate">{handle ? `@${handle}` : emptyLabel}</span>
      {collabs.length > 0 && (
        <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1 font-medium text-primary">
          +{collabs.length}
        </span>
      )}
    </span>
  );
}
