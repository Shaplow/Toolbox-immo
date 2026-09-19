"use client";

/**
 * ShootAvailabilityPrompt — « es-tu disponible pour ce tournage ? ».
 *
 * Ne passe pas par `wrap()`, et ce n'est pas un oubli : le contrat de section
 * gate par RÔLE, alors que ce bandeau gate par IDENTITÉ — seul l'assigné
 * répond, et le serveur refuserait quelqu'un d'autre. Confondre les deux axes
 * a déjà produit un bug (un admin assigné se retrouvait sans moyen de
 * répondre) ; le passer dans la matrice le rejouerait sous une autre forme.
 *
 * Porte sa confirmation de refus, comme le fait déjà `ShootAvailabilityStrip`
 * sur la page d'accueil pour la même action sur la même route.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { MAX_DECLINE_REASON } from "@/lib/entityAvailability";
import type { EntityFicheData } from "./ficheTypes";

export interface ShootAvailabilityPromptProps {
  entity: Pick<EntityFicheData, "id" | "videasteConfirmation" | "scheduledAtLabel">;
}

export function ShootAvailabilityPrompt({ entity }: ShootAvailabilityPromptProps) {
  const router = useRouter();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [answering, setAnswering] = useState(false);

  async function answerAvailability(answer: "CONFIRMED" | "DECLINED", reason?: string) {
    setAnswering(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videasteConfirmation: answer,
          ...(answer === "DECLINED" ? { videasteDeclineReason: reason ?? "" } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success(
        answer === "CONFIRMED" ? "Disponibilité confirmée." : "Indisponibilité signalée.",
      );
      setDeclineOpen(false);
      setDeclineReason("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setAnswering(false);
    }
  }

  return (
    <>
      <div
        className={[
          "rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3",
          entity.videasteConfirmation === "DECLINED"
            ? "border-danger-200 bg-danger-50"
            : "border-warning-200 bg-warning-50",
        ].join(" ")}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">
            {entity.videasteConfirmation === "DECLINED"
              ? "Vous avez signalé votre indisponibilité"
              : "Êtes-vous disponible pour ce tournage ?"}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {entity.videasteConfirmation === "DECLINED"
              ? "L'admin est prévenu. Vous pouvez encore revenir sur votre réponse."
              : entity.scheduledAtLabel
                ? `Prévu le ${entity.scheduledAtLabel}. Confirmez pour que l'admin sache que la date est tenue.`
                : "Confirmez pour que l'admin sache que le tournage est pris en charge."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Reste proposé après un refus : se libérer est le cas normal, et
              le serveur accepte déjà DECLINED → CONFIRMED. Sans ce bouton,
              seul l'admin pouvait débloquer, en réassignant. */}
          <Button
            size="sm"
            onClick={() => void answerAvailability("CONFIRMED")}
            disabled={answering}
          >
            {entity.videasteConfirmation === "DECLINED"
              ? "Finalement, je suis disponible"
              : "Je suis disponible"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeclineOpen(true)}
            disabled={answering}
          >
            {entity.videasteConfirmation === "DECLINED"
              ? "Modifier le motif"
              : "Je ne suis pas disponible"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={declineOpen}
        title="Signaler une indisponibilité ?"
        description="L'admin est prévenu. Vous pourrez revenir sur cette réponse tant que le tournage n'a pas eu lieu."
        confirmLabel="Je ne suis pas disponible"
        variant="danger"
        loading={answering}
        onConfirm={() => void answerAvailability("DECLINED", declineReason)}
        onCancel={() => {
          setDeclineOpen(false);
          setDeclineReason("");
        }}
      >
        <textarea
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          rows={3}
          maxLength={MAX_DECLINE_REASON}
          placeholder="Motif (optionnel, visible par l'admin)…"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </ConfirmDialog>
    </>
  );
}
