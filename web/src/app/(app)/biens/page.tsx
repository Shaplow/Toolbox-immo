import { redirect } from "next/navigation";

/**
 * /biens — ancienne surface « Bien » (Property). Plan simplification Phase 5
 * (métaobjet) : fusionnée dans /fiches (Entity/EntityType, type « Bien »).
 */
export const dynamic = "force-dynamic";

export default function BiensRedirect() {
  redirect("/fiches?type=etype_bien");
}
