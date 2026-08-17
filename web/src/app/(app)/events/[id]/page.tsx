import { redirect } from "next/navigation";

/**
 * /events/[id] — ancienne fiche « Événement » (ShootEvent). Plan
 * simplification Phase 5 (métaobjet) : la migration id-preserving a repris
 * les ids de ShootEvent dans Entity, donc le redirect pointe directement sur
 * le même id.
 */
export const dynamic = "force-dynamic";

export default async function EventDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/fiches/${id}`);
}
