"use client";

/**
 * PatternPeekDrawer — drawer d'aperçu rapide d'une recette éditoriale.
 *
 * Charge GET /api/admin/patterns/[id]/peek à l'ouverture, affiche
 * PatternSummaryCard. Le footer expose au choix :
 *  - "Éditer" (si `onOpenEdit` fourni) — déclenche l'ouverture du drawer
 *    d'édition existant côté parent.
 *  - "Aller au catalogue" (toujours) — fallback navigation vers
 *    /admin/patterns pour les usages hors-contexte.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { toast } from "@/components/ui/Toast";
import {
  PatternSummaryCard,
  type PatternPeekData,
} from "./PatternSummaryCard";

interface PatternPeekDrawerProps {
  open: boolean;
  patternTemplateId: string | null;
  onClose: () => void;
  /** Si fourni, le drawer affiche un bouton "Éditer" qui appelle ce callback. */
  onOpenEdit?: (patternTemplateId: string) => void;
}

export function PatternPeekDrawer({
  open,
  patternTemplateId,
  onClose,
  onOpenEdit,
}: PatternPeekDrawerProps) {
  const router = useRouter();
  const [data, setData] = useState<PatternPeekData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !patternTemplateId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/patterns/${patternTemplateId}/peek`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${res.status}`);
        }
        const payload = (await res.json()) as PatternPeekData;
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
  }, [open, patternTemplateId, onClose]);

  function goToCatalog() {
    router.push("/admin/patterns");
    onClose();
  }

  function triggerEdit() {
    if (!patternTemplateId || !onOpenEdit) return;
    onOpenEdit(patternTemplateId);
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} side="right" size="md">
      <Drawer.Header onClose={onClose}>Aperçu recette</Drawer.Header>
      <Drawer.Body>
        {loading || !data ? <SkeletonPattern /> : <PatternSummaryCard data={data} />}
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fermer
        </Button>
        {onOpenEdit ? (
          <Button
            variant="primary"
            size="sm"
            icon={Edit}
            onClick={triggerEdit}
            disabled={!patternTemplateId}
          >
            Éditer
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={ArrowRight}
            iconRight
            onClick={goToCatalog}
          >
            Aller au catalogue
          </Button>
        )}
      </Drawer.Footer>
    </Drawer>
  );
}

function SkeletonPattern() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 rounded bg-white/50" />
          <div className="h-3 w-24 rounded bg-white/40" />
        </div>
        <div className="h-10 w-10 rounded bg-white/40" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-5 rounded bg-white/40" />
        ))}
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-white/40" />
        ))}
      </div>
    </div>
  );
}
