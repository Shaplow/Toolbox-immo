"use client";

/**
 * AttachedSlotsSection — les publications rattachées à la fiche.
 *
 * Porte sa confirmation de retrait, qui est portalée : sa place dans l'arbre
 * n'a aucun effet de clipping ni d'empilement.
 *
 * `cancelTarget` garde le SLOT entier, pas son id. Un simple id obligerait à
 * le retrouver dans la liste — ce qui ne marche plus depuis qu'il y en a deux.
 *
 * ## Deux relations, deux groupes
 *
 * Une fiche peut être à la fois le TOURNAGE de publications (`shootEntityId`)
 * et la SOURCE DE DONNÉES d'autres (`entityId`). Les deux listes arrivent déjà
 * du serveur, mais `attachMode` n'en affichait qu'une — une fiche des deux
 * côtés en cachait donc la moitié, alors que la suppression, elle, compte bien
 * leur somme pour refuser de supprimer.
 *
 * `attachMode` ne décide plus de CE QUI S'AFFICHE, seulement de CE QU'ON PEUT
 * AJOUTER. Le second groupe n'est monté que s'il contient quelque chose : une
 * fiche à une seule relation reste donc identique au pixel.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Film, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/molecules/Section";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { TERMINAL_STATUSES } from "@/types/roles";
import { shortDateTimeFr } from "@/lib/date/formatFr";
import { slotBadgeLabel } from "@/lib/slots/statusLabels";
import type { SlotStatus } from "@/types/calendar";
import {
  AttachSlotModal,
  type AttachRecipeOption,
  type AttachAccountOption,
  type AttachShootTypeOption,
} from "../AttachSlotModal";
import type { FicheSectionChromeProps } from "@/components/fiches/sectionShell";
import type { EntityFicheData, EntitySlotRef } from "../ficheTypes";

/** N'apparaît que quand les deux relations coexistent — sinon, rien à distinguer. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export interface AttachedSlotsSectionProps extends FicheSectionChromeProps {
  entity: Pick<EntityFicheData, "id" | "label" | "slots" | "shootSlots">;
  attachMode: "missions" | "reel";
  canAttachSlot: boolean;
  canCancelSlot: boolean;
  recipes: AttachRecipeOption[];
  accounts: AttachAccountOption[];
  shootTypes?: AttachShootTypeOption[];
  defaultShootTypeId?: string | null;
}

export function AttachedSlotsSection({
  entity,
  attachMode,
  canAttachSlot,
  canCancelSlot,
  recipes,
  accounts,
  shootTypes = [],
  defaultShootTypeId = null,
  sectionId = "publications",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: AttachedSlotsSectionProps) {
  const router = useRouter();
  const [attachOpen, setAttachOpen] = useState(false);

  // Retrait d'un reel depuis la fiche : le monteur voit ses vidéos ici, il doit
  // pouvoir en retirer une sans passer par le calendrier.
  const [cancelTarget, setCancelTarget] = useState<EntitySlotRef | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  async function confirmCancelSlot() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/publications/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Échec du retrait.");
        return;
      }
      toast.success("Vidéo retirée.");
      setCancelTarget(null);
      setCancelReason("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setCancelling(false);
    }
  }

  const isReelMode = attachMode === "reel";
  // Le groupe « du mode » — celui qu'on peut alimenter depuis cette fiche.
  const primarySlots = isReelMode ? entity.shootSlots : entity.slots;
  // L'autre relation. Présente ou non, elle ne se crée pas d'ici.
  const secondarySlots = isReelMode ? entity.slots : entity.shootSlots;
  const attachedLabel = isReelMode ? "Reels attachés" : "Publications";
  const secondaryLabel = isReelMode
    ? "Publications qui utilisent cette fiche"
    : "Reels tournés pour cette fiche";
  const attachButtonLabel = isReelMode ? "Ajouter un reel" : "Lancer des publications";
  const showBothGroups = secondarySlots.length > 0;

  function renderSlotList(slots: EntitySlotRef[]) {
    return (
      <ul className="divide-y divide-border">
        {slots.map((slot) => {
          const removed = slot.status === "CANCELLED";
          return (
            <li key={slot.id} className="flex items-center gap-1">
              <Link
                href={`/publications/${slot.id}`}
                className="flex flex-1 min-w-0 items-center justify-between gap-3 px-2 py-2.5 rounded-md hover:bg-muted transition-colors focus-ring"
              >
                <div className="min-w-0">
                  {/* Une vidéo retirée reste listée — c'est ce qui explique
                      « pourquoi 4 et pas 5 » — mais elle ne doit pas se
                      lire comme une vidéo encore à produire. */}
                  <p
                    className={[
                      "text-[13px] font-medium truncate",
                      removed ? "text-muted-foreground line-through" : "text-foreground",
                    ].join(" ")}
                  >
                    {slot.title ?? "Reel"}
                  </p>
                  {slot.scheduledAt && (
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTimeFr(slot.scheduledAt)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground rounded-md bg-muted px-1.5 py-0.5 border border-border">
                  {slotBadgeLabel(slot.status as SlotStatus, slot.scheduledAt)}
                </span>
              </Link>
              {canCancelSlot && !removed && !(TERMINAL_STATUSES as readonly string[]).includes(slot.status) && (
                <ButtonIcon
                  icon={Ban}
                  label="Retirer cette vidéo"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCancelTarget(slot);
                    setCancelReason("");
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <Section
        title={attachedLabel}
        icon={Film}
        description={`${primarySlots.length + secondarySlots.length}`}
        sectionId={sectionId}
        storageKey={storageKey}
        defaultOpen={defaultOpen}
        collapsible={collapsible}
        actions={
          canAttachSlot ? (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAttachOpen(true)}>
              {attachButtonLabel}
            </Button>
          ) : undefined
        }
      >
        <div>
          {showBothGroups && <GroupHeading>{attachedLabel}</GroupHeading>}
          {primarySlots.length === 0 ? (
            <EmptyState
              icon={<Film size={20} className="text-muted-foreground" />}
              title={isReelMode ? "Aucun reel" : "Aucune publication"}
              description={
                isReelMode
                  ? "Accrochez des reels à cette fiche — pendant ou après, autant que nécessaire."
                  : "Lancez des publications depuis cette fiche — une par recette."
              }
              {...(canAttachSlot ? { cta: { label: attachButtonLabel, onClick: () => setAttachOpen(true) } } : {})}
            />
          ) : (
            renderSlotList(primarySlots)
          )}
          {showBothGroups && (
            <>
              <GroupHeading>{secondaryLabel}</GroupHeading>
              {renderSlotList(secondarySlots)}
            </>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Retirer cette vidéo ?"
        description={`« ${cancelTarget?.title ?? "Reel"} » passera au statut « Annulée » et sortira des worklists. Rien n'est supprimé, et la commande ne la recréera pas.`}
        confirmLabel="Retirer la vidéo"
        variant="danger"
        loading={cancelling || !cancelReason.trim()}
        onConfirm={() => {
          void confirmCancelSlot();
        }}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
      >
        <Textarea
          value={cancelReason}
          onChange={setCancelReason}
          rows={2}
          placeholder="Motif (ex : pas de rushs pour cette vidéo)"
        />
      </ConfirmDialog>

      {canAttachSlot && attachOpen && (
        <AttachSlotModal
          entityId={entity.id}
          entityLabel={entity.label}
          mode={attachMode}
          recipes={recipes}
          accounts={accounts}
          shootTypes={shootTypes}
          defaultShootTypeId={defaultShootTypeId}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </>
  );
}
