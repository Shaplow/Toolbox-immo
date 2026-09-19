"use client";

/**
 * EntityFiche — l'assembleur de la fiche métaobjet.
 *
 * Ne porte plus rien lui-même : chaque section est autonome, avec son état, ses
 * actions et ses confirmations. Ce fichier ne décide que de ce qui est MONTÉ,
 * selon les capacités du type (hasPlanning / hasRushes / …) — pas de ce que les
 * sections font une fois montées.
 *
 * Les sections ne se parlent pas. Après une écriture, chacune appelle
 * `router.refresh()` et les autres reçoivent leurs nouvelles props du serveur :
 * c'est le seul canal, avec l'événement d'ouverture de section. Aucune prop ne
 * transite d'une section à l'autre en passant par ici.
 *
 * La charpente est celle de `/publications/[id]` : `FicheShell`. C'est lui qui
 * remplace `PageShell` sur cette route — les deux ne s'imbriquent pas.
 */

import { needsVideasteAnswer } from "@/lib/entityAvailability";
import { FicheShell } from "@/components/fiches/FicheShell";
import {
  createSectionWrapper,
  type SectionsByRole,
} from "@/components/fiches/sectionShell";
import type { UserRole } from "@/types/roles";
import { EntityRushesPanel } from "@/components/entities/EntityRushesPanel";
import { EntityFicheHeader } from "./EntityFicheHeader";
import { ShootAvailabilityPrompt } from "./ShootAvailabilityPrompt";
import { FieldsSection } from "./sections/FieldsSection";
import { PlanningSection } from "./sections/PlanningSection";
import { AttachedSlotsSection } from "./sections/AttachedSlotsSection";
import { ActivitySection } from "./sections/ActivitySection";
import type {
  AttachRecipeOption,
  AttachAccountOption,
  AttachShootTypeOption,
} from "./AttachSlotModal";

export type {
  EntityRush,
  EntitySlotRef,
  EntityActivityItem,
  EntityFicheData,
} from "./ficheTypes";
import type { EntityFicheData } from "./ficheTypes";

/** Les sections de la fiche — clé de matrice, ancre DOM et suffixe de stockage. */
type EntitySectionKey = "fields" | "planning" | "rushes" | "publications" | "activity";

/**
 * Qui voit quoi. `planning` n'apparaît dans aucune liste : c'est CE tableau qui
 * le réserve à l'admin, et non plus un `isAdmin &&` au point de montage — sinon
 * ajouter `planning` à un rôle ici ne produirait rien, et la recherche du
 * pourquoi partirait dans le mauvais fichier.
 */
const ENTITY_SECTIONS_BY_ROLE: SectionsByRole<EntitySectionKey> = {
  VIDEASTE: ["fields", "rushes", "publications", "activity"],
  MONTEUR: ["fields", "rushes", "publications", "activity"],
  CM: ["fields", "rushes", "publications", "activity"],
  // N'atteint jamais cette route (entityScope le coupe avant le rendu). Si ça
  // changeait, la fiche n'aurait qu'un en-tête et rien dessous.
  EXTERNAL_GENERATOR: [],
};

export interface EntityFicheProps {
  entity: EntityFicheData;
  role: UserRole;
  /** Édition label/champs/planning : réservé ADMIN (cf. ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE). */
  isAdmin: boolean;
  canMarkShot: boolean;
  canUploadRushes: boolean;
  canManageRushes: boolean;
  canAttachSlot: boolean;
  /** Retirer un reel sans rushs — ADMIN, MONTEUR, VIDEASTE (cf. canCancelSlot). */
  canCancelSlot: boolean;
  attachMode: "missions" | "reel";
  recipes: AttachRecipeOption[];
  accounts: AttachAccountOption[];
  /** Types de tournage du modèle de commande — vide si la fiche n'en vient pas. */
  shootTypes?: AttachShootTypeOption[];
  defaultShootTypeId?: string | null;
  videastes: { id: string; name: string }[];
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  currentUserId: string;
  backHref: string;
}

export function EntityFiche({
  entity,
  role,
  isAdmin,
  canMarkShot,
  canUploadRushes,
  canManageRushes,
  canAttachSlot,
  canCancelSlot,
  attachMode,
  recipes,
  accounts,
  shootTypes = [],
  defaultShootTypeId = null,
  videastes,
  monteurs,
  cms,
  currentUserId,
  backHref,
}: EntityFicheProps) {
  const { wrap } = createSectionWrapper<EntitySectionKey>({
    role,
    sectionsByRole: ENTITY_SECTIONS_BY_ROLE,
    storagePrefix: `fiche-section:${entity.id}`,
  });

  // Le bandeau ne s'adresse qu'à l'ASSIGNÉ du tournage : la passerelle d'accès
  // par reel (entityScope) amène ici d'autres vidéastes, qui ne répondent pas
  // à sa place — et le serveur les refuserait.
  //
  // Le test ne porte plus `!isAdmin` : le select des vidéastes accepte les
  // comptes ADMIN (fiches/[id]/page.tsx), et un admin ainsi assigné se
  // retrouvait sans aucun moyen de répondre — la fiche affichait « en attente »
  // indéfiniment. C'est l'identité de l'assigné qui décide, pas le rôle.
  const isAssignedVideaste = currentUserId === entity.assigneeVideasteId;
  const showAvailabilityPrompt = isAssignedVideaste && needsVideasteAnswer(entity);


  return (
    <FicheShell
      header={
        <EntityFicheHeader
          entity={entity}
          isAdmin={isAdmin}
          canMarkShot={canMarkShot}
          backHref={backHref}
        />
      }
      banner={showAvailabilityPrompt ? <ShootAvailabilityPrompt entity={entity} /> : undefined}
      chain={
        entity.notes ? (
          <p className="mt-4 text-[13px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {entity.notes}
          </p>
        ) : undefined
      }
      aside={
        entity.activities.length > 0
          ? wrap("activity", <ActivitySection activities={entity.activities} />)
          : undefined
      }
      asideStickyTop="xl:top-[104px]"
    >
      {/* Champs custom */}
      {wrap("fields", <FieldsSection entity={entity} isAdmin={isAdmin} />)}

      {/* Planning & équipe */}
      {entity.hasPlanning &&
        wrap(
          "planning",
          <PlanningSection
            entity={entity}
            isAdmin={isAdmin}
            videastes={videastes}
            monteurs={monteurs}
            cms={cms}
          />,
        )}

      {/* Rushs de la fiche — panel partagé avec le détail de commande. */}
      {entity.hasRushes &&
        wrap(
          "rushes",
          <EntityRushesPanel
            entityId={entity.id}
            rushes={entity.rushes}
            canUpload={canUploadRushes}
            canManage={canManageRushes}
            currentUserId={currentUserId}
          />,
        )}

      {/* Reels / publications rattachés */}
      {wrap(
        "publications",
        <AttachedSlotsSection
          entity={entity}
          attachMode={attachMode}
          canAttachSlot={canAttachSlot}
          canCancelSlot={canCancelSlot}
          recipes={recipes}
          accounts={accounts}
          shootTypes={shootTypes}
          defaultShootTypeId={defaultShootTypeId}
        />,
      )}
    </FicheShell>
  );
}
