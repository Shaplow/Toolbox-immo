/**
 * /export/[token] — page publique de téléchargement des contenus d'un client.
 *
 * Accessible SANS authentification : le jeton de l'URL EST l'authentification
 * (haché en base, avec expiration et révocation — cf. verifyExportToken). Hors du
 * groupe (app) : pas de session, pas de navigation admin.
 *
 * AUCUN effet de bord au GET : les robots d'aperçu de lien (WhatsApp, iMessage,
 * Slack) chargent cette URL à l'envoi du message. L'ouverture n'est enregistrée
 * que par l'appel au manifeste, que seule la page exécutée dans un navigateur
 * déclenche.
 *
 * États :
 * - jeton inconnu (ou mal formé) → 404 générique (not-found.tsx)
 * - expiré / révoqué             → carte d'explication, aucune donnée du client
 * - valide                       → <ExportDownloader>
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExportDownloader } from "@/components/clientExport/ExportDownloader";
import { ExportPageFrame } from "@/components/clientExport/ExportPageFrame";
import { LinkUnavailableCard } from "@/components/clientExport/LinkUnavailableCard";
import { verifyExportToken } from "@/lib/services/clientExport/exportLinks";

type PageProps = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Téléchargement de tes contenus",
  // Pas d'indexation : le lien donne accès à des fichiers privés.
  robots: { index: false, follow: false },
  // Le jeton est dans l'URL : il ne doit jamais partir en Referer vers un tiers
  // (stockage R2 pour les téléchargements, CDN…).
  referrer: "no-referrer",
};

export default async function ExportPage({ params }: PageProps) {
  const { token } = await params;
  const verification = await verifyExportToken(token);

  if (!verification.valid) {
    if (verification.reason === "not_found") notFound();
    return (
      <ExportPageFrame centered>
        <LinkUnavailableCard
          title={verification.reason === "expired" ? "Ce lien a expiré" : "Ce lien a été désactivé"}
          description="Demande un nouveau lien à ton interlocuteur."
        />
      </ExportPageFrame>
    );
  }

  const { link } = verification;
  return (
    <ExportPageFrame>
      <ExportDownloader token={token} clientName={link.clientName} expiresAt={link.expiresAt.toISOString()} />
    </ExportPageFrame>
  );
}
