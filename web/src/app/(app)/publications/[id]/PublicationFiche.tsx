"use client";

/**
 * PublicationFiche — wrapper client pour la fiche publication.
 *
 * En Phase 1.3.4 ce composant sert de point d'ancrage pour l'état interactif
 * qui sera ajouté en 1.3.5 (actions) et 1.3.6 (commentaires).
 * Le layout sticky du header et le scroll vers les sections sont déjà en place.
 */

import { PublicationHeader } from "@/components/publications/PublicationHeader";
import { ProductionChain } from "@/components/publications/ProductionChain";
import type { PublicationStep } from "@/lib/publications/steps";

interface AssigneeInfo {
  id: string;
  name: string | null;
  email: string | null;
}

interface SlotInfo {
  id: string;
  title: string | null;
  status: string;
  scheduledAt: Date;
  contentType: string;
}

interface AccountInfo {
  id: string;
  handle: string;
  name: string;
  offre: string;
}

interface RecipeInfo {
  id: string;
  code: string;
  label: string;
}

export interface PublicationFicheProps {
  slot: SlotInfo;
  account: AccountInfo;
  listing: { id: string } | null;
  recipe: RecipeInfo | null;
  assigneeMonteur: AssigneeInfo | null;
  assigneeCm: AssigneeInfo | null;
  steps: PublicationStep[];
  canMarkPublished: boolean;
  canDelete: boolean;
}

export function PublicationFiche({
  slot,
  account,
  listing,
  recipe,
  assigneeMonteur,
  assigneeCm,
  steps,
  canMarkPublished,
  canDelete,
}: PublicationFicheProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header sticky */}
      <PublicationHeader
        slot={slot}
        account={account}
        listing={listing}
        recipe={recipe}
        assigneeMonteur={assigneeMonteur}
        assigneeCm={assigneeCm}
        canMarkPublished={canMarkPublished}
        canDelete={canDelete}
      />

      {/* Corps de la fiche */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Chaîne de production */}
        <ProductionChain steps={steps} />

        {/* Sections outils — placeholders Phase 1.3.5 */}
        <section id="render" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Rendu vidéo</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        <section id="cover" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Cover</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        <section id="captions" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Sous-titres</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        <section id="description" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Description</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        <section id="validation" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Validation client</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        <section id="publish" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Publication</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.5)</p>
        </section>

        {/* Section commentaires — placeholder Phase 1.3.6 */}
        <section id="comments" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Commentaires</h2>
          <p className="text-sm text-gray-400 italic">Section à venir (Phase 1.3.6)</p>
        </section>
      </div>
    </div>
  );
}
