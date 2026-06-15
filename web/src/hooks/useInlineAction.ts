"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";

interface ActionConfig {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: object;
  successMessage?: string;
  errorPrefix?: string;
}

/**
 * Hook générique pour les actions inline sur les listes (Inbox, BankView, etc.)
 *
 * Extrait du pattern de EditReviewQuickActions (Sprint B livré) — fetch + toast
 * + router.refresh. Réutilisable pour tous les types d'action d'item.
 *
 * Usage :
 *   const { trigger, pending } = useInlineAction();
 *   <button onClick={() => trigger({
 *     url: `/api/publications/${id}/versions/${vid}/promote`,
 *     successMessage: "Version validée",
 *   })} disabled={pending}>Valider</button>
 */
export function useInlineAction<TResult = unknown>() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const trigger = useCallback(
    async (config: ActionConfig): Promise<TResult | null> => {
      setPending(true);
      try {
        const res = await fetch(config.url, {
          method: config.method ?? "POST",
          headers: config.body ? { "Content-Type": "application/json" } : undefined,
          body: config.body ? JSON.stringify(config.body) : undefined,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const data = (await res.json().catch(() => ({}))) as TResult;
        if (config.successMessage) toast.success(config.successMessage);
        router.refresh();
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur";
        toast.error(
          config.errorPrefix ? `${config.errorPrefix} : ${msg}` : msg,
        );
        return null;
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  return { trigger, pending };
}
