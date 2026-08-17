/**
 * Page 404 dédiée au flow validation client externe.
 *
 * Affichée quand le token est invalide / expiré / révoqué, ou quand le slot
 * n'existe plus. Message neutre anti-énumération (on ne distingue pas les cas)
 * et UI explicite "lien invalide" — PAS de redirection vers /login pour éviter
 * la confusion (l'user externe n'a pas de compte Toolbox).
 *
 * Sans cette page, Next.js sert sa 404 par défaut qui peut être confondue avec
 * un écran de connexion selon les thèmes.
 */

import Link from "next/link";

export default function ValidateNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-6xl">🔗</div>
        <h1 className="text-2xl font-semibold text-foreground">Ce lien n&apos;est plus valide</h1>
        <p className="text-[14px] text-muted-foreground leading-relaxed">
          Le lien de validation que tu as utilisé est expiré, révoqué ou la publication a déjà été
          traitée. Demande à ton interlocuteur Toolbox de te renvoyer un lien à jour.
        </p>
        <p className="text-[12px] text-muted-foreground">
          <Link href="/" className="underline hover:text-muted-foreground">
            Retour à l&apos;accueil
          </Link>
        </p>
      </div>
    </div>
  );
}
