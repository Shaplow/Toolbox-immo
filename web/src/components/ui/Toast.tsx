"use client";

import { create } from "zustand";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

/**
 * Système de toasts — feedback transient pour les actions utilisateur.
 *
 * - 3 types : success / error / info (sémantique uniquement).
 * - Style aligné doctrine : monochrome avec icône sémantique colorée,
 *   shadow-overlay, rounded-md, density Linear.
 * - Auto-dismiss après 4s. Click pour fermer immédiatement.
 * - Affiché via <ToastContainer /> en bas à droite (déjà inclus dans
 *   le RootLayout).
 *
 * Usage : `toast.success("Slot créé.")` / `toast.error("Échec.")` /
 *         `toast.info("Synchronisation en cours…")`.
 */

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (message: string, type?: ToastType) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  add: (message, type = "info") => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (msg: string) => useToastStore.getState().add(msg, "success"),
  error:   (msg: string) => useToastStore.getState().add(msg, "error"),
  info:    (msg: string) => useToastStore.getState().add(msg, "info"),
};

const TYPE_ICON = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
};

const TYPE_ICON_CLS = {
  success: "text-success-600",
  error:   "text-danger-600",
  info:    "text-info-600",
};

function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5 rounded-md shadow-[var(--shadow-overlay)] bg-white border border-gray-200 text-[13px] max-w-sm cursor-pointer text-gray-950"
      onClick={onRemove}
      role="alert"
    >
      <Icon size={15} className={`${TYPE_ICON_CLS[item.type]} shrink-0 mt-0.5`} />
      <span className="flex-1 leading-relaxed">{item.message}</span>
      <button
        className="text-gray-400 hover:text-gray-700 shrink-0 mt-0.5"
        aria-label="Fermer"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Drop this in your root layout once. */
export function ToastContainer() {
  const { toasts, remove } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onRemove={() => remove(t.id)} />
      ))}
    </div>
  );
}
