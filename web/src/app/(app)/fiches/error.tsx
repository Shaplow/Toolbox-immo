"use client";

import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { TriangleAlert } from "lucide-react";

/** Erreur /fiches — état récupérable avec retry (V3.2). */
export default function FichesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell variant="narrow">
      <EmptyState
        icon={TriangleAlert}
        title="Impossible de charger les fiches"
        description="Une erreur est survenue. Réessaie — si le problème persiste, préviens un administrateur."
        cta={{ label: "Réessayer", onClick: reset }}
      />
    </PageShell>
  );
}
