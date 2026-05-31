/**
 * Legacy redirect — V5.C.2.
 *
 * Aucun lien interne ne pointe vers /tools/description depuis Phase 1.x.
 * Conservé pour compat bookmarks anciens utilisateurs.
 * Préserve les searchParams (slotId, returnTo, etc.) en re-construisant
 * la query string avant le redirect.
 * Drop prévu après 1-2 mois si les logs montrent 0 hit.
 */
import { redirect } from "next/navigation";

export default async function DescriptionLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
  }
  const qs = query.toString();
  redirect(`/descriptions${qs ? `?${qs}` : ""}`);
}
