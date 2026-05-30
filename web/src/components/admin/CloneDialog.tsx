"use client";

/**
 * CloneDialog — clone tous les patterns d'un autre compte vers le compte
 * courant. Modal MID Liquid Glass + Combobox fuzzy.
 */

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";

type AccountOption = {
  id: string;
  handle: string;
  name: string;
  clientName: string | null;
};

interface CloneDialogProps {
  open: boolean;
  accountId: string;
  onClose: () => void;
  onCloned: () => void;
}

export function CloneDialog({ open, accountId, onClose, onCloned }: CloneDialogProps) {
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingAccounts(true);
    void fetch("/api/admin/accounts")
      .then((r) => r.json())
      .then((data: unknown) => {
        const raw = Array.isArray(data) ? data : [];
        const options: AccountOption[] = (
          raw as Array<{
            id: string;
            handle: string;
            name: string;
            client?: { name: string } | null;
          }>
        )
          .filter((a) => a.id !== accountId)
          .map((a) => ({
            id: a.id,
            handle: a.handle,
            name: a.name,
            clientName: a.client?.name ?? null,
          }));
        setAccounts(options);
      })
      .catch(() => {
        toast.error("Impossible de charger la liste des comptes");
      })
      .finally(() => setLoadingAccounts(false));
  }, [open, accountId]);

  async function handleClone() {
    if (!sourceAccountId) {
      toast.error("Sélectionnez un compte source");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/patterns/clone-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAccountId }),
      });
      const data = (await res.json()) as { cloned?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Erreur lors du clonage");
        return;
      }
      toast.success(`${data.cloned ?? 0} pattern(s) cloné(s)`);
      setSourceAccountId("");
      onCloned();
      onClose();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const accountOptions = [
    { value: "", label: "— Sélectionner un compte —" },
    ...accounts.map((a) => ({
      value: a.id,
      label: a.clientName ? `@${a.handle} · ${a.clientName}` : `@${a.handle}`,
      keywords: [a.handle, a.name, a.clientName ?? ""],
    })),
  ];

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header onClose={onClose}>Cloner depuis un autre compte</Modal.Header>

      <Modal.Body>
        <p className="text-[12.5px] text-gray-500 mb-4">
          Tous les patterns du compte source seront copiés vers ce compte. Les patterns
          existants ne sont pas écrasés.
        </p>

        <FormField label="Compte source" required>
          {loadingAccounts ? (
            <p className="text-[12px] text-gray-400 py-2">Chargement des comptes…</p>
          ) : accounts.length === 0 ? (
            <p className="text-[12px] text-gray-400 py-2">Aucun autre compte disponible.</p>
          ) : (
            <Combobox
              value={sourceAccountId}
              onChange={setSourceAccountId}
              options={accountOptions}
              placeholder="Choisir un compte"
              emptyMessage="Aucun compte trouvé"
            />
          )}
        </FormField>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="ghost" size="md" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          size="md"
          icon={Copy}
          loading={loading}
          disabled={!sourceAccountId}
          onClick={() => void handleClone()}
        >
          Cloner
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
