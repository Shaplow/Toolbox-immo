import { redirect } from "next/navigation";

/**
 * /biens/[id] — ancienne fiche « Bien » (Property). Plan simplification
 * Phase 5 (métaobjet) : la migration id-preserving a repris les ids de
 * Property dans Entity, donc le redirect pointe directement sur le même id.
 */
export const dynamic = "force-dynamic";

export default async function BienEditorRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/fiches/${id}`);
}
