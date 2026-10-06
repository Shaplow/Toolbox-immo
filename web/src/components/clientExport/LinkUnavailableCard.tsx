/**
 * Carte « ce lien ne marche plus » — partagée par la page serveur (expiré,
 * désactivé), son 404 et l'écran de téléchargement (lien révoqué entre-temps).
 *
 * Aucune donnée du client n'y figure : le visiteur n'a pas (ou plus) de lien
 * valide, il ne doit rien apprendre du contenu qu'il visait.
 */

import { Link2Off } from "lucide-react";
import { Card } from "@/components/ui/Card";

interface LinkUnavailableCardProps {
  title: string;
  description: string;
  /** h1 quand la carte est la page entière, h2 sous l'en-tête du téléchargeur. */
  as?: "h1" | "h2";
}

export function LinkUnavailableCard({ title, description, as: Heading = "h1" }: LinkUnavailableCardProps) {
  return (
    <Card className="text-center">
      <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Link2Off size={18} />
      </span>
      <Heading className="mt-4 text-lg font-semibold text-foreground">{title}</Heading>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    </Card>
  );
}
