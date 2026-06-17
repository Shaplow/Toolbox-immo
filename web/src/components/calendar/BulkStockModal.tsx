"use client";

/**
 * BulkStockModal — admin crée N missions en banque en un seul coup.
 *
 * Cible un compte + pattern (`source = manual_rushes`) et insère N slots
 * sans date programmée (scheduledAt: null). Le monteur les voit dans sa
 * worklist "Missions banque (sans date)" et peut commencer à produire.
 *
 * Body API : `POST /api/calendar/slots/bulk-stock`
 */

import { useEffect, useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";

interface Account {
  id: string;
  name: string;
  handle: string;
}

interface AssigneeOption {
  id: string;
  label: string;
}

interface PatternOption {
  id: string;
  label: string;
  defaultAssigneeMonteurId: string | null;
}

interface BulkStockModalProps {
  accounts: Account[];
  monteurs: AssigneeOption[];
  /** Compte pré-sélectionné (depuis le filtre actif du calendrier). */
  defaultAccountId?: string;
  onCreated: (count: number) => void;
  onClose: () => void;
}

const DEFAULT_QUANTITY = 5;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 20;

export function BulkStockModal({
  accounts,
  monteurs,
  defaultAccountId,
  onCreated,
  onClose,
}: BulkStockModalProps) {
  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? "");
  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternId, setPatternId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(DEFAULT_QUANTITY);
  const [monteurOverride, setMonteurOverride] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge les patterns manual_rushes du compte sélectionné.
  useEffect(() => {
    if (!accountId) {
      setPatterns([]);
      setPatternId("");
      return;
    }
    let cancelled = false;
    setPatternsLoading(true);
    void (async () => {
      try {
        // P2 — fetch bindings (au lieu d'AccountPattern legacy). On filtre
        // côté client sur source=manual_rushes + isActive, comme avant.
        const res = await fetch(`/api/admin/accounts/${accountId}/bindings`);
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const data = (await res.json()) as Array<{
          id: string;
          customLabel: string | null;
          isActive: boolean;
          defaultAssigneeMonteurId: string | null;
          patternTemplate: { label: string; source: string };
        }>;
        if (cancelled) return;
        const filtered = data
          .filter((b) => b.patternTemplate.source === "manual_rushes" && b.isActive)
          .map((b) => ({
            id: b.id,
            label: b.customLabel ?? b.patternTemplate.label,
            defaultAssigneeMonteurId: b.defaultAssigneeMonteurId,
          }));
        setPatterns(filtered);
        if (filtered.length === 1) {
          setPatternId(filtered[0].id);
        }
      } catch {
        if (!cancelled) setPatterns([]);
      } finally {
        if (!cancelled) setPatternsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const selectedPattern = useMemo(
    () => patterns.find((p) => p.id === patternId) ?? null,
    [patterns, patternId],
  );

  const resolvedMonteurLabel = useMemo(() => {
    if (monteurOverride) {
      return monteurs.find((m) => m.id === monteurOverride)?.label ?? null;
    }
    if (selectedPattern?.defaultAssigneeMonteurId) {
      return (
        monteurs.find((m) => m.id === selectedPattern.defaultAssigneeMonteurId)?.label ??
        null
      );
    }
    return null;
  }, [monteurOverride, selectedPattern, monteurs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!accountId) return setError("Choisis un compte Instagram.");
    if (!patternId) return setError("Choisis un pattern « Montage rushes ».");
    if (
      !Number.isFinite(quantity) ||
      quantity < MIN_QUANTITY ||
      quantity > MAX_QUANTITY
    ) {
      return setError(`Quantité entre ${MIN_QUANTITY} et ${MAX_QUANTITY}.`);
    }

    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          patternId,
          quantity,
          monteurId: monteurOverride || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as { count: number };
      toast.success(`${data.count} mission${data.count > 1 ? "s" : ""} ajoutée${data.count > 1 ? "s" : ""} à la banque`);
      onCreated(data.count);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="p-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-warning-100 text-warning-700 shrink-0">
            <PackagePlus size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              Missions
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-foreground">
              Créer des missions sans date
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Le monteur produit, tu programmes plus tard depuis la banque.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <FormField label="Compte Instagram">
            <Combobox
              value={accountId}
              onChange={(v) => {
                setAccountId(v);
                setPatternId("");
                setMonteurOverride("");
              }}
              options={accounts.map((a) => ({
                value: a.id,
                label: `${a.name} · @${a.handle}`,
              }))}
              placeholder="Choisir un compte"
            />
          </FormField>

          <FormField
            label="Recette « Montage rushes »"
            help={
              !accountId
                ? "Choisis d'abord un compte."
                : patternsLoading
                  ? "Chargement…"
                  : patterns.length === 0
                    ? "Aucune recette « Montage rushes » active sur ce compte."
                    : undefined
            }
          >
            <Combobox
              value={patternId}
              onChange={setPatternId}
              options={patterns.map((p) => ({ value: p.id, label: p.label }))}
              placeholder={patterns.length === 0 ? "—" : "Choisir un pattern"}
              disabled={!accountId || patterns.length === 0}
            />
          </FormField>

          <FormField label="Quantité" help={`Entre ${MIN_QUANTITY} et ${MAX_QUANTITY}`}>
            <Input
              id="bulk-quantity"
              type="number"
              min={MIN_QUANTITY}
              max={MAX_QUANTITY}
              step={1}
              value={String(quantity)}
              onChange={(v) => setQuantity(Number(v) || 0)}
              required
            />
          </FormField>

          <FormField
            label="Monteur"
            help={
              resolvedMonteurLabel
                ? `Assigné·e à ${resolvedMonteurLabel}.`
                : "Aucun monteur assigné par défaut sur ce pattern. Choisis-en un."
            }
          >
            <Combobox
              value={monteurOverride}
              onChange={setMonteurOverride}
              options={[
                { value: "", label: "(défaut pattern)" },
                ...monteurs.map((m) => ({ value: m.id, label: m.label })),
              ]}
              disabled={!selectedPattern}
            />
          </FormField>
        </div>

        {error && <p className="mt-4 text-[12px] text-danger-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={PackagePlus}
            loading={saving}
            disabled={!accountId || !patternId}
          >
            Créer {quantity > 0 ? `${quantity} mission${quantity > 1 ? "s" : ""}` : "missions"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
