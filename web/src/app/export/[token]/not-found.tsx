/**
 * 404 dédiée à /export/[token] — jeton inconnu ou mal formé.
 *
 * Message neutre : on ne dit pas si le lien a existé (anti-énumération), et PAS
 * de redirection ni de lien vers /login ou l'accueil : le visiteur n'a pas de
 * compte Toolbox, un écran de connexion le laisserait croire qu'il doit en
 * créer un. Même esprit que validate/[token]/not-found.tsx.
 */

import { ExportPageFrame } from "@/components/clientExport/ExportPageFrame";
import { LinkUnavailableCard } from "@/components/clientExport/LinkUnavailableCard";

export default function ExportNotFound() {
  return (
    <ExportPageFrame centered>
      <LinkUnavailableCard
        title="Ce lien n'est plus valide"
        description="Le lien de téléchargement que tu as utilisé est incorrect, expiré ou désactivé. Demande un nouveau lien à ton interlocuteur."
      />
    </ExportPageFrame>
  );
}
