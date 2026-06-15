"use client";

/**
 * BulkReplaceAssigneeModal — Sprint C.
 *
 * Permet de remplacer l'assignée par défaut sur tous les PatternBinding
 * d'un compte donné. Utile quand un monteur quitte l'équipe et qu'il faut
 * basculer en masse vers son remplaçant.
 *
 * POST /api/admin/accounts/[id]/bindings/bulk-replace-assignee.
 */

import { useState } from "react";
import { UserCheck, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";

interface User {
  id: string;
  name: string;
}

interface Props {
  accountId: string;
  monteurs: User[];
  cms: User[];
  videastes: User[];
  onReplaced: (updatedCount: number) => void;
  onClose: () => void;
}

type Role = "monteur" | "cm" | "videaste";

export function BulkReplaceAssigneeModal({
  accountId,
  monteurs,
  cms,
  videastes,
  onReplaced,
  onClose,
}: Props) {
  const [role, setRole] = useState<Role>("monteur");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = role === "monteur" ? monteurs : role === "cm" ? cms : videastes;
  const roleLabel =
    role === "monteur"
      ? "Monteur"
      : role === "cm"
        ? "Community manager"
        : "Vidéaste";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (from === to) {
      setError("Choisis des utilisateurs différents pour from et to.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/accounts/${accountId}/bindings/bulk-replace-assignee`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            from: from || null,
            to: to || null,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as { updatedCount: number };
      toast.success(
        data.updatedCount === 0
          ? "Aucun binding ne correspondait"
          : `${data.updatedCount} liaison${data.updatedCount > 1 ? "s" : ""} mise${data.updatedCount > 1 ? "s" : ""} à jour`,
      );
      onReplaced(data.updatedCount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="p-5">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 shrink-0">
            <UserCheck size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
              Remplacement en lot
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-gray-950">
              Remplacer une assignée par défaut
            </h2>
            <p className="mt-0.5 text-[12px] text-gray-500">
              Met à jour toutes les liaisons de ce compte où le rôle choisi
              vaut « de ». Les slots historiques ne sont pas affectés.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <FormField label="Rôle à remplacer">
            <Combobox
              value={role}
              onChange={(v) => setRole(v as Role)}
              options={[
                { value: "monteur", label: "Monteur" },
                { value: "cm", label: "Community manager" },
                { value: "videaste", label: "Vidéaste" },
              ]}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={`De (${roleLabel} actuel)`} help="Vide = bindings non assignés">
              <Combobox
                value={from}
                onChange={setFrom}
                options={[
                  { value: "", label: "— Non assigné —" },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
            </FormField>
            <FormField
              label={`Vers (nouveau ${roleLabel})`}
              help="Vide = retirer l'assignation"
            >
              <Combobox
                value={to}
                onChange={setTo}
                options={[
                  { value: "", label: "— Retirer —" },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
              />
            </FormField>
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={X}
            onClick={onClose}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={UserCheck}
            loading={saving}
          >
            Remplacer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
