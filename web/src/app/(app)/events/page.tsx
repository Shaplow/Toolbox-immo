import { redirect } from "next/navigation";

/**
 * /events — ancienne surface « Événements » (ShootEvent). Plan
 * simplification Phase 5 (métaobjet) : fusionnée dans /fiches
 * (Entity/EntityType, type « Tournage »).
 */
export const dynamic = "force-dynamic";

export default function EventsRedirect() {
  redirect("/fiches?type=etype_tournage");
}
