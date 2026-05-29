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

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";

const Z_BASE = 50;

interface DialogStackEntry {
  id: string;
  onClose?: () => void;
}

interface DialogStackStore {
  stack: DialogStackEntry[];
  push: (id: string, onClose?: () => void) => void;
  pop: (id: string) => void;
  indexOf: (id: string) => number;
  topId: () => string | null;
}

const useDialogStackStore = create<DialogStackStore>()((set, get) => ({
  stack: [],
  push: (id, onClose) => {
    if (get().stack.some((e) => e.id === id)) return;
    set({ stack: [...get().stack, { id, onClose }] });
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
  const [zIndex, setZIndex] = useState(Z_BASE);
  const stack = useDialogStackStore((s) => s.stack);

  // Register / unregister.
  useEffect(() => {
    if (!open) return;
    useDialogStackStore.getState().push(id, onClose);
    return () => {
      useDialogStackStore.getState().pop(id);
    };
  }, [open, id, onClose]);

  // Update zIndex à chaque fois que la stack change.
  useEffect(() => {
    if (!open) return;
    const idx = useDialogStackStore.getState().indexOf(id);
    if (idx >= 0) setZIndex(Z_BASE + idx * 10);
  }, [open, id, stack]);

  // ESC handler — uniquement si je suis au sommet.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useDialogStackStore.getState().topId() === id) {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, id, onClose]);

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

  return { zIndex, isTop: useDialogStackStore.getState().topId() === id };
}
