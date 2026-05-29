"use client";

/**
 * useImpersonation — actions admin centralisées : stop impersonation +
 * set/clear view-as role.
 *
 * Avant Phase 6.1, ces actions étaient dupliquées dans 2 fichiers :
 * AppNav.tsx (stopImpersonation + setViewAsRole) et ImpersonationBanner.tsx
 * (stopActiveMode). Les deux implémentations divergeaient (router.push
 * différent, pas d'error handling). Ce hook unifie le tout.
 *
 * Bénéfices :
 * - Source unique de vérité pour les paths stop/setViewAs.
 * - Error handling : toast.error si fetch échoue (avant : router.refresh()
 *   fire quand même → UI/cookie désync silencieux).
 * - Aucune divergence de comportement entre la nav et la bannière top.
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "@/components/ui/Toast";

type ViewAsRole = "VIDEASTE" | "MONTEUR" | "CM" | null;

export interface UseImpersonationApi {
  /** Stop l'impersonation en cours + redirige vers /admin/users. */
  stopImpersonation: () => Promise<void>;
  /** Active une vue-rôle (ou désactive si null), reste sur la page courante. */
  setViewAsRole: (role: ViewAsRole) => Promise<void>;
}

export function useImpersonation(): UseImpersonationApi {
  const router = useRouter();

  const stopImpersonation = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/impersonation", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      toast.error(`Impossible de quitter l'impersonation : ${msg}`);
    }
  }, [router]);

  const setViewAsRole = useCallback(
    async (role: ViewAsRole) => {
      try {
        const res =
          role === null
            ? await fetch("/api/admin/view-as", { method: "DELETE" })
            : await fetch("/api/admin/view-as", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role }),
              });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur réseau";
        toast.error(`Impossible de changer la vue : ${msg}`);
      }
    },
    [router],
  );

  return { stopImpersonation, setViewAsRole };
}
