"use client";

/**
 * AccountPeekDrawer — drawer d'aperçu rapide d'un compte Instagram.
 *
 * Charge GET /api/admin/accounts/[id]/peek à l'ouverture, affiche
 * AccountSummaryCard, et expose un CTA "Voir la fiche complète" qui navigue
 * vers /admin/accounts/[id] pour les opérations qui requièrent la fiche
 * intégrale (édition recettes, curseurs, archive, etc.).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { toast } from "@/components/ui/Toast";
import {
  AccountSummaryCard,
  type AccountPeekData,
} from "./AccountSummaryCard";

interface AccountPeekDrawerProps {
  open: boolean;
  accountId: string | null;
  onClose: () => void;
}

export function AccountPeekDrawer({
  open,
  accountId,
  onClose,
}: AccountPeekDrawerProps) {
  const router = useRouter();
  const [data, setData] = useState<AccountPeekData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !accountId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/accounts/${accountId}/peek`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const payload = (await res.json()) as AccountPeekData;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Aperçu indisponible");
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, onClose]);

  function goToFullView() {
    if (!accountId) return;
    router.push(`/admin/accounts/${accountId}`);
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" size="md">
      <Drawer.Header onClose={onClose}>Aperçu compte</Drawer.Header>
      <Drawer.Body>
        {loading || !data ? (
          <SkeletonAccount />
        ) : (
          <AccountSummaryCard data={data} />
        )}
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fermer
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={ArrowRight}
          iconRight
          onClick={goToFullView}
          disabled={!accountId}
        >
          Voir la fiche complète
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}

function SkeletonAccount() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-2.5 w-24 rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-20 rounded-xl bg-muted" />
    </div>
  );
}
