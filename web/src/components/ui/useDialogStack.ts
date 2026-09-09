"use client";

/**
 * Stack global de dialogues (modal, drawer, sheet, popover…).
 *
 * Résout 3 problèmes :
 * 1. Z-index : chaque dialogue ouvert reçoit un z-index = base + index, ce
 *    qui garantit que les modals empilées s'affichent dans l'ordre attendu
 *    (et notamment au-dessus des DropdownMenu d'avant Liquid Glass).
 * 2. ESC : ne ferme QUE le dialogue au sommet de la pile (pas toute la pile
 *    d'un coup), comportement attendu UX.
 * 3. Body scroll lock : verrouille le scroll du document tant qu'au moins
 *    un dialogue est ouvert, restauré à la fermeture du dernier.
 *
 * Usage :
 *
 * ```tsx
 * function MyModal({ open, onClose }) {
 *   const { zIndex } = useRegisterDialog(open, onClose);
 *   if (!open) return null;
 *   return <div style={{ zIndex }}>...</div>;
 * }
 * ```
 */

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

const Z_BASE = 50;

interface DialogStackEntry {
  id: string;
}

interface DialogStackStore {
  stack: DialogStackEntry[];
  push: (id: string) => void;
  pop: (id: string) => void;
  indexOf: (id: string) => number;
  topId: () => string | null;
}

const useDialogStackStore = create<DialogStackStore>()((set, get) => ({
  stack: [],
  push: (id) => {
    if (get().stack.some((e) => e.id === id)) return;
    set({ stack: [...get().stack, { id }] });
  },
  pop: (id) => {
    set({ stack: get().stack.filter((e) => e.id !== id) });
  },
  indexOf: (id) => get().stack.findIndex((e) => e.id === id),
  topId: () => {
    const stack = get().stack;
    return stack.length > 0 ? stack[stack.length - 1].id : null;
  },
}));

let counter = 0;
function generateId() {
  counter += 1;
  return `dlg-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Hook à appeler dans chaque composant dialogue. Retourne le `zIndex`
 * effectif à appliquer sur le backdrop et le panel.
 *
 * Le panel doit utiliser `zIndex + 1` pour passer au-dessus du backdrop.
 */
export function useRegisterDialog(open: boolean, onClose?: () => void) {
  const id = useMemo(() => generateId(), []);
  const stack = useDialogStackStore((s) => s.stack);

  // `onClose` est presque toujours une lambda inline côté appelant, donc une
  // nouvelle référence à chaque rendu. La garder hors des dépendances d'effet
  // est ce qui évite la boucle : sinon register se rejoue à chaque rendu →
  // pop+push → nouvelle référence de `stack` (à laquelle ce composant est
  // abonné) → rendu → … jusqu'au « Maximum update depth exceeded ».
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Register / unregister.
  useEffect(() => {
    if (!open) return;
    useDialogStackStore.getState().push(id);
    return () => {
      useDialogStackStore.getState().pop(id);
    };
  }, [open, id]);

  // Position dans la pile → z-index, dérivé au rendu. C'était auparavant un
  // useState alimenté par un effet : ce setState relançait un rendu à chaque
  // mutation du store, l'autre moitié de la boucle corrigée ci-dessus. Une
  // valeur entièrement déductible de `stack` n'a pas à être un état.
  const idx = stack.findIndex((e) => e.id === id);
  const zIndex = idx >= 0 ? Z_BASE + idx * 10 : Z_BASE;

  // ESC handler — uniquement si je suis au sommet.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useDialogStackStore.getState().topId() === id) {
        e.stopPropagation();
        onCloseRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, id]);

  // Body scroll lock — gère le compteur via le store.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      // Si je suis le dernier, restore. Sinon laisse le suivant gérer.
      if (useDialogStackStore.getState().stack.length === 0) {
        document.body.style.overflow = prevOverflow || "";
      }
    };
  }, [open]);

  // `isTop` se dérive de la même source que le z-index, donc se rafraîchit
  // quand un autre dialogue s'ouvre ou se ferme au-dessus.
  return { zIndex, isTop: stack.length > 0 && stack[stack.length - 1].id === id };
}
