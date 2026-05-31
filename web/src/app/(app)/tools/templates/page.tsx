/**
 * Legacy redirect — V5.C.2.
 *
 * Aucun lien interne ne pointe vers /tools/templates depuis Phase 1.x.
 * Conservé pour compat bookmarks anciens utilisateurs.
 * Drop prévu après 1-2 mois si les logs montrent 0 hit.
 */
import { redirect } from "next/navigation";

export default function TemplatesLegacyRedirect() {
  redirect("/templates");
}
