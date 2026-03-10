"use client";

import { create } from "zustand";
import { useEffect } from "react";

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
    const id = String(Date.now());
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers */
export const toast = {
  success: (msg: string) => useToastStore.getState().add(msg, "success"),
  error: (msg: string) => useToastStore.getState().add(msg, "error"),
  info: (msg: string) => useToastStore.getState().add(msg, "info"),
};

const TYPE_STYLES: Record<ToastType, string> = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-gray-800 text-white",
};

function ToastItem({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  useEffect(() => {
    // Allow click to dismiss
  }, []);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm max-w-sm cursor-pointer ${TYPE_STYLES[item.type]}`}
      onClick={onRemove}
      role="alert"
    >
      <span className="flex-1">{item.message}</span>
      <button className="opacity-70 hover:opacity-100 ml-1 leading-none text-base">×</button>
    </div>
  );
}

/** Drop this in your root layout once */
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
