"use client";

/**
 * DeployTemplateModal — Sprint C.
 *
 * Permet à l'admin d'appliquer une ou PLUSIEURS recettes PatternTemplate à N
 * comptes Instagram en 1 click, depuis le drawer d'édition recette (une seule)
 * ou depuis une sélection du catalogue (plusieurs).
 *
 * Champs communs (binding) : publishTime, dayOfWeek, defaultAssignees.
 *
 * POST /api/admin/patterns/deploy (N recettes × N comptes, résultats partiels).
 */

import { useEffect, useMemo, useState } from "react";
import { Rocket, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import {
  BindingScheduleFields,
  type AssigneeOption,
  type BindingScheduleValues,
} from "@/components/admin/shared/BindingScheduleFields";

interface AccountOption {
  id: string;
  name: string;
  handle: string;
}

export interface DeployTarget {
  id: string;
  label: string;
}

interface Props {
  /** Une ou plusieurs recettes à appliquer. */
  templates: DeployTarget[];
  onDeployed: (createdCount: number) => void;
  onClose: () => void;
}

interface DeployData {
  accounts: AccountOption[];
  /** Renseigné uniquement pour une recette unique — cf. eligibleAccounts. */
  alreadyLinkedAccountIds: string[];
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
}

export function DeployTemplateModal({ templates, onDeployed, onClose }: Props) {
  const single = templates.length === 1;
  const templateIds = useMemo(() => templates.map((t) => t.id), [templates]);
  const templateIdsKey = templateIds.join(",");

  const [data, setData] = useState<DeployData | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [schedule, setSchedule] = useState<BindingScheduleValues>(() => ({
    publishTime: "10:00",
    // Sur une sélection multiple, imposer Lun-Ven à dix recettes fabriquerait
    // dix publications par jour et par compte. Les reels naissent en banque :
    // planning vide par défaut, à renseigner sciemment.
    dayOfWeek: templates.length > 1 ? [] : [1, 2, 3, 4, 5],
    monteurId: "",
    cmId: "",
    videasteId: "",
  }));
  function updateSchedule(patch: Partial<BindingScheduleValues>) {
    setSchedule((prev) => ({ ...prev, ...patch }));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge la liste des comptes IG + les listes d'assignées. Les bindings
  // existants ne sont chargés que pour une recette unique : sur une sélection,
  // « déjà lié » diffère d'une recette à l'autre et le service skippe déjà
  // chaque couple (recette, compte) qui existe.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [accountsRes, templateRes, monteursRes, cmsRes, videastesRes, adminsRes] =
          await Promise.all([
            fetch("/api/admin/accounts"),
            single ? fetch(`/api/admin/patterns/${templateIds[0]}`) : Promise.resolve(null),
            fetch("/api/admin/users?role=MONTEUR"),
            fetch("/api/admin/users?role=CM"),
            fetch("/api/admin/users?role=VIDEASTE"),
            fetch("/api/admin/users?role=ADMIN"),
          ]);
        if (cancelled) return;
        const accounts = accountsRes.ok
          ? ((await accountsRes.json()) as AccountOption[])
          : [];
        const tpl =
          templateRes && templateRes.ok
            ? ((await templateRes.json()) as { bindings?: { accountId: string }[] })
            : { bindings: [] };
        // Chaque réponse est DÉJÀ filtrée par rôle côté serveur (payload allégé
        // {id,name,email}, SANS champ `role`). On les utilise donc directement —
        // re-filtrer sur `u.role` renvoyait des listes vides (le bug). Les ADMIN
        // sont ajoutés à chaque liste : un admin peut être assigné comme
        // monteur / cm / vidéaste (cf. assertAssigneeRole).
        const parseUsers = async (r: Response): Promise<AssigneeOption[]> =>
          r.ok ? ((await r.json().catch(() => [])) as AssigneeOption[]) : [];
        const [monteurUsers, cmUsers, videasteUsers, adminUsers] = await Promise.all([
          parseUsers(monteursRes),
          parseUsers(cmsRes),
          parseUsers(videastesRes),
          parseUsers(adminsRes),
        ]);
        const monteurs = [...monteurUsers, ...adminUsers];
        const cms = [...cmUsers, ...adminUsers];
        const videastes = [...videasteUsers, ...adminUsers];
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
  }, [templateIdsKey, templateIds, single]);

  const eligibleAccounts = useMemo(() => {
    if (!data) return [];
    if (!single) return data.accounts;
    const linked = new Set(data.alreadyLinkedAccountIds);
    return data.accounts.filter((a) => !linked.has(a.id));
  }, [data, single]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selectedAccountIds.size === 0) {
      setError("Sélectionne au moins un compte.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/patterns/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patternTemplateIds: templateIds,
          accountIds: [...selectedAccountIds],
          publishTime: schedule.publishTime,
          dayOfWeek: schedule.dayOfWeek,
          defaultAssigneeMonteurId: schedule.monteurId || null,
          defaultAssigneeCmId: schedule.cmId || null,
          defaultAssigneeVideasteId: schedule.videasteId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const result = (await res.json()) as {
        createdCount: number;
        skippedCount: number;
        failed: { patternTemplateId: string; error: string }[];
      };
      const labelOf = (id: string) =>
        templates.find((t) => t.id === id)?.label ?? "Recette";
      if (result.failed.length > 0) {
        // Résultat partiel : ne pas annoncer un succès franc. Le premier
        // message porte la cause, le reste se compte.
        toast.error(
          `${result.failed.length} recette${result.failed.length > 1 ? "s" : ""} en échec — ` +
            `${labelOf(result.failed[0].patternTemplateId)} : ${result.failed[0].error}`,
        );
      }
      if (result.createdCount > 0 || result.failed.length === 0) {
        toast.success(
          result.skippedCount > 0
            ? `${result.createdCount} liaison${result.createdCount > 1 ? "s" : ""} créée${result.createdCount > 1 ? "s" : ""} · ${result.skippedCount} déjà liée${result.skippedCount > 1 ? "s" : ""}`
            : `${result.createdCount} liaison${result.createdCount > 1 ? "s" : ""} créée${result.createdCount > 1 ? "s" : ""}`,
        );
      }
      onDeployed(result.createdCount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  const title = single
    ? `Appliquer « ${templates[0].label} »`
    : `Appliquer ${templates.length} recettes`;

  return (
    <Modal open onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="p-5">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted border border-border text-foreground shrink-0">
            <Rocket size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold text-foreground truncate">{title}</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {single
                ? "Sélectionne les comptes destinataires et le planning."
                : "Chaque recette est appliquée à chaque compte ; les liaisons déjà existantes sont ignorées."}
            </p>
            {!single && (
              <p className="mt-1 text-[11px] text-muted-foreground truncate">
                {templates.map((t) => t.label).join(" · ")}
              </p>
            )}
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

        {/* Planning & équipe */}
        <div className="mt-4">
          <BindingScheduleFields
            values={schedule}
            onChange={updateSchedule}
            monteurs={data?.monteurs ?? []}
            cms={data?.cms ?? []}
            videastes={data?.videastes ?? []}
            dayOfWeekHelp={
              single
                ? undefined
                : "Vide = les publications naissent en banque, sans génération automatique."
            }
          />
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
            Appliquer ({selectedAccountIds.size * templates.length})
          </Button>
        </div>
      </form>
    </Modal>
  );
}
