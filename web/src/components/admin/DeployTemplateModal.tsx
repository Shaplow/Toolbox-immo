"use client";

/**
 * DeployTemplateModal — Sprint C.
 *
 * Permet à l'admin d'appliquer une recette PatternTemplate à N comptes
 * Instagram en 1 click depuis le drawer d'édition recette.
 *
 * Champs communs (binding) : publishTime, dayOfWeek (Lun-Ven par défaut),
 * defaultAssignees.
 *
 * POST /api/admin/patterns/[id]/deploy.
 */

import { useEffect, useMemo, useState } from "react";
import { Rocket, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 7, label: "Dim" },
];

interface AccountOption {
  id: string;
  name: string;
  handle: string;
}

interface AssigneeOption {
  id: string;
  name: string;
}

interface Props {
  templateId: string;
  templateLabel: string;
  onDeployed: (createdCount: number) => void;
  onClose: () => void;
}

interface DeployData {
  accounts: AccountOption[];
  alreadyLinkedAccountIds: string[];
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
}

export function DeployTemplateModal({
  templateId,
  templateLabel,
  onDeployed,
  onClose,
}: Props) {
  const [data, setData] = useState<DeployData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [publishTime, setPublishTime] = useState("10:00");
  const [dayOfWeek, setDayOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monteurId, setMonteurId] = useState<string>("");
  const [cmId, setCmId] = useState<string>("");
  const [videasteId, setVideasteId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge la liste des comptes IG + les bindings existants pour cette
  // recette (pour exclure ceux déjà liés) + les listes d'assignées.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [accountsRes, templateRes, monteursRes, cmsRes, videastesRes] =
          await Promise.all([
            fetch("/api/admin/accounts"),
            fetch(`/api/admin/patterns/${templateId}`),
            fetch("/api/admin/users?role=MONTEUR"),
            fetch("/api/admin/users?role=CM"),
            fetch("/api/admin/users?role=VIDEASTE"),
          ]);
        if (cancelled) return;
        const accounts = accountsRes.ok
          ? ((await accountsRes.json()) as AccountOption[])
          : [];
        const tpl = templateRes.ok
          ? ((await templateRes.json()) as {
              bindings?: { accountId: string }[];
            })
          : { bindings: [] };
        const allUsers = (
          [
            await monteursRes.json().catch(() => []),
            await cmsRes.json().catch(() => []),
            await videastesRes.json().catch(() => []),
          ] as Array<{ id: string; name: string; role: string }[]>
        ).flat();
        const monteurs = allUsers
          .filter((u) => u.role === "MONTEUR" || u.role === "ADMIN")
          .map((u) => ({ id: u.id, name: u.name }));
        const cms = allUsers
          .filter((u) => u.role === "CM" || u.role === "ADMIN")
          .map((u) => ({ id: u.id, name: u.name }));
        const videastes = allUsers
          .filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN")
          .map((u) => ({ id: u.id, name: u.name }));
        setData({
          accounts,
          alreadyLinkedAccountIds: (tpl.bindings ?? []).map((b) => b.accountId),
          monteurs,
          cms,
          videastes,
        });
      } catch {
        if (!cancelled) setError("Erreur de chargement");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const eligibleAccounts = useMemo(() => {
    if (!data) return [];
    const linked = new Set(data.alreadyLinkedAccountIds);
    return data.accounts.filter((a) => !linked.has(a.id));
  }, [data]);

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedAccountIds(new Set(eligibleAccounts.map((a) => a.id)));
  }

  function selectNone() {
    setSelectedAccountIds(new Set());
  }

  function toggleDay(d: number) {
    setDayOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selectedAccountIds.size === 0) {
      setError("Sélectionne au moins un compte.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/${templateId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: [...selectedAccountIds],
          publishTime,
          dayOfWeek,
          defaultAssigneeMonteurId: monteurId || null,
          defaultAssigneeCmId: cmId || null,
          defaultAssigneeVideasteId: videasteId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const result = (await res.json()) as {
        createdCount: number;
        skippedCount: number;
      };
      toast.success(
        result.skippedCount > 0
          ? `${result.createdCount} déployées · ${result.skippedCount} déjà liées`
          : `${result.createdCount} compte${result.createdCount > 1 ? "s" : ""} lié${result.createdCount > 1 ? "s" : ""}`,
      );
      onDeployed(result.createdCount);
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
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted border border-border text-foreground shrink-0">
            <Rocket size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-foreground truncate">
              Appliquer « {templateLabel} »
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Sélectionne les comptes destinataires et le planning.
            </p>
          </div>
        </div>

        {/* Liste comptes */}
        <div className="mt-4 rounded-md bg-card border border-border p-3 max-h-56 overflow-y-auto">
          {loadingData ? (
            <p className="text-[12px] text-muted-foreground">Chargement…</p>
          ) : eligibleAccounts.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Aucun compte éligible (tous déjà appliqués).
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground">
                  {selectedAccountIds.size}/{eligibleAccounts.length} sélectionnés
                </span>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={selectAll}
                  >
                    Tout
                  </button>
                  <span className="text-muted-foreground/60">·</span>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:underline"
                    onClick={selectNone}
                  >
                    Aucun
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {eligibleAccounts.map((a) => {
                  const isSelected = selectedAccountIds.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAccount(a.id)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12px] transition-colors ${
                        isSelected
                          ? "bg-accent text-accent-foreground border border-border"
                          : "bg-card text-foreground border border-border hover:bg-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="h-3.5 w-3.5 rounded border-border pointer-events-none"
                      />
                      <span className="truncate">@{a.handle}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Planning */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <FormField label="Heure de publication" required>
            <Input
              id="deploy-time"
              type="time"
              value={publishTime}
              onChange={setPublishTime}
              required
            />
          </FormField>
          <FormField label="Jours auto-générés">
            <div className="inline-flex gap-1 flex-wrap">
              {DAYS.map((d) => {
                const active = dayOfWeek.includes(d.value);
                return (
                  <button
                    type="button"
                    key={d.value}
                    onClick={() => toggleDay(d.value)}
                    className={`h-7 px-2 rounded-md text-[11.5px] font-medium border transition-colors ${
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-card text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </FormField>
        </div>

        {/* Assignées */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <FormField label="Vidéaste défaut">
            <Combobox
              value={videasteId}
              onChange={setVideasteId}
              options={[
                { value: "", label: "— Aucun —" },
                ...(data?.videastes ?? []).map((u) => ({
                  value: u.id,
                  label: u.name,
                })),
              ]}
            />
          </FormField>
          <FormField label="Monteur défaut">
            <Combobox
              value={monteurId}
              onChange={setMonteurId}
              options={[
                { value: "", label: "— Aucun —" },
                ...(data?.monteurs ?? []).map((u) => ({
                  value: u.id,
                  label: u.name,
                })),
              ]}
            />
          </FormField>
          <FormField label="CM défaut">
            <Combobox
              value={cmId}
              onChange={setCmId}
              options={[
                { value: "", label: "— Aucun —" },
                ...(data?.cms ?? []).map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </FormField>
        </div>

        {error && <p className="mt-3 text-[12px] text-danger-700">{error}</p>}

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
            icon={Rocket}
            loading={saving}
            disabled={selectedAccountIds.size === 0}
          >
            Appliquer ({selectedAccountIds.size})
          </Button>
        </div>
      </form>
    </Modal>
  );
}
