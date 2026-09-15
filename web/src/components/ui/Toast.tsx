"use client";

import { create } from "zustand";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

/**
 * Système de toasts — feedback transient pour les actions utilisateur.
 *
 * 3 types sémantiques : success / error / info. Auto-dismiss 4s.
 * Click pour fermer. Affiché via <ToastContainer /> bas-droite (RootLayout).
 *
 * Usage : `toast.success("Slot créé.")` etc.
 */

export type ToastType = "success" | "error" | "info";

/**
 * Action optionnelle portée par le toast — un « Annuler » après coup.
 *
 * Pour les gestes qu'on déclenche d'un mouvement plutôt que d'un clic réfléchi
 * (un glisser-déposer, typiquement) : une modale de confirmation en fin de drag
 * est bancale, alors qu'un rattrapage offert juste après se lit sans effort.
 */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (message: string, type?: ToastType, action?: ToastAction) => void;
  remove: (id: string) => void;
}

/** Un toast qui propose une action reste plus longtemps : il faut le lire, puis décider. */
const DISMISS_MS = 4000;
const DISMISS_WITH_ACTION_MS = 9000;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  add: (message, type = "info", action) => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action }] }));
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      action ? DISMISS_WITH_ACTION_MS : DISMISS_MS,
    );
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (msg: string, action?: ToastAction) =>
    useToastStore.getState().add(msg, "success", action),
  error:   (msg: string, action?: ToastAction) =>
    useToastStore.getState().add(msg, "error", action),
  info:    (msg: string, action?: ToastAction) =>
    useToastStore.getState().add(msg, "info", action),
};

const TYPE_ICON = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
};

const TYPE_ICON_CLS = {
  success: "text-success-600",
  error:   "text-danger-600",
  info:    "text-primary",
};

const TYPE_ACCENT_CLS = {
  success: "border-l-success-600",
  error:   "border-l-danger-600",
  info:    "border-l-primary",
};

function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <div
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md border border-border border-l-4 bg-card text-card-foreground shadow-lg text-[13px] max-w-sm cursor-pointer ${TYPE_ACCENT_CLS[item.type]}`}
      onClick={onRemove}
      role="alert"
    >
      <Icon size={15} className={`${TYPE_ICON_CLS[item.type]} shrink-0 mt-0.5`} />
      <span className="flex-1 leading-relaxed">{item.message}</span>
      {item.action && (
        <button
          type="button"
          // Le conteneur se ferme au clic : sans stopPropagation, l'action
          // partirait ET le toast disparaîtrait, sans qu'on sache lequel a agi.
          onClick={(e) => {
            e.stopPropagation();
            item.action!.onClick();
            onRemove();
          }}
          className="shrink-0 font-medium text-primary hover:underline"
        >
          {item.action.label}
        </button>
      )}
      <button
        className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
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
    // Ancré en haut : en bas à droite, la pile recouvrait le pied des drawers
    // et des modales — donc précisément les boutons « Annuler / Enregistrer »
    // qu'un toast d'erreur de validation demande de re-cliquer.
    // `top-20` laisse passer le bandeau d'impersonation.
    <div className="fixed top-20 right-6 z-[9999] flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onRemove={() => remove(t.id)} />
      ))}
    </div>
  );
}
