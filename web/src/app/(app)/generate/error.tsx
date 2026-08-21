"use client";

import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { TriangleAlert } from "lucide-react";

/**
 * Erreur /generate — état récupérable avec retry (B.4, P6).
 *
 * Avant ce fix, /generate n'avait aucun error.tsx : une erreur RSC (fiche
 * introuvable, requête prefill qui échoue au montage, etc.) laissait l'user
 * sur une page qui semble morte — le formulaire reste visible et éditable,
 * mais "Générer" ne mène plus nulle part. Ce boundary couvre /generate et
 * /generate/[templateId].
 */
export default function GenerateError({ reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell variant="narrow">
      <EmptyState
        icon={TriangleAlert}
        title="Impossible de charger la génération"
        description="Une erreur est survenue. Réessaie — si le problème persiste, préviens un administrateur."
        cta={{ label: "Réessayer", onClick: reset }}
      />
    </PageShell>
  );
}
