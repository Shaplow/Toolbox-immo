"use client";

/**
 * Le contrat de section, partagé par les deux fiches du produit.
 *
 * `/publications/[id]` l'a inventé et s'en sert bien : chaque section reçoit une
 * ancre (`sectionId`), une mémoire de pliage (`storageKey`), et n'est montée que
 * si le rôle a quelque chose à y faire. La fiche métaobjet (`/fiches/[id]`), elle,
 * appelle la même primitive `Section` SANS rien de tout ça — d'où des sections
 * sans ancre, sans mémoire, et visibles par tout le monde.
 *
 * Ce module ne fait qu'extraire l'existant : aucune règle nouvelle, aucun
 * comportement ajouté. Le paramétrage (préfixe de stockage, matrice de rôles)
 * est ce qui permet aux deux surfaces d'en partager le corps sans partager
 * leurs listes de sections, qui n'ont rien à voir l'une avec l'autre.
 */

import { cloneElement, type ReactElement } from "react";
import type { UserRole } from "@/types/roles";

/**
 * Sections montées pour un rôle donné. Une section HORS liste n'est pas
 * rendue du tout — pas « repliée » : pas de chevron à ignorer, pas de bruit
 * pour un rôle qui n'a rien à y faire.
 *
 * L'ADMIN n'a pas d'entrée : il voit tout (cf. `createSectionWrapper`).
 */
/**
 * Ce que `wrap()` injecte dans une section, par `cloneElement`.
 *
 * Toute section de fiche étend ce type. L'injection reste castée en
 * `Record<string, unknown>` plus bas — donc TypeScript ne vérifie pas
 * l'appariement — mais au moins la prop EXISTE dans la signature, ce que la
 * fiche publication n'a jamais eu : une section qui oublie de les déclarer
 * perd son ancre et sa mémoire en silence.
 */
export interface FicheSectionChromeProps {
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

export type SectionsByRole<K extends string> = Record<Exclude<UserRole, "ADMIN">, K[]>;

export interface SectionWrapperOptions<K extends string> {
  /** Rôle du lecteur — décide de ce qui est monté. */
  role: UserRole;
  sectionsByRole: SectionsByRole<K>;
  /**
   * Préfixe des clés localStorage, incluant l'id de l'objet : la mémoire de
   * pliage est PAR fiche, sinon replier une section sur l'une la replierait
   * partout.
   */
  storagePrefix: string;
  /**
   * Sections que le rôle ne voit jamais, quelle que soit la liste — l'ADMIN
   * excepté. Sert au fil d'activité, qui est un journal d'audit.
   */
  adminOnly?: readonly K[];
}

/**
 * Fabrique le `wrap()` d'une fiche.
 *
 * `permanent: true` retire le pli/dépli des sections critiques qui doivent
 * rester ouvertes (Rendu, Sous-titres côté publication) : pas de localStorage,
 * pas de chevron, mais l'ancre reste — le clic depuis la chaîne d'étapes doit
 * continuer d'y amener.
 */
export function createSectionWrapper<K extends string>({
  role,
  sectionsByRole,
  storagePrefix,
  adminOnly = [],
}: SectionWrapperOptions<K>) {
  const isVisible = (key: K): boolean => {
    if (role === "ADMIN") return true;
    if (adminOnly.includes(key)) return false;
    return sectionsByRole[role as Exclude<UserRole, "ADMIN">]?.includes(key) ?? false;
  };

  const wrap = (key: K, node: ReactElement, permanent?: boolean): ReactElement | null => {
    if (!isVisible(key)) return null;
    if (permanent) {
      return cloneElement(node, {
        sectionId: key,
        collapsible: false,
      } as Record<string, unknown>);
    }
    return cloneElement(node, {
      sectionId: key,
      storageKey: `${storagePrefix}:${key}`,
      // Tout ce qui est monté est déplié ; un repli manuel se mémorise.
      defaultOpen: true,
      collapsible: true,
    } as Record<string, unknown>);
  };

  return { wrap, isVisible };
}
