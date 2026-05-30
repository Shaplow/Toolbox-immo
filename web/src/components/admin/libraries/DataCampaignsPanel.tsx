"use client";

/**
 * DataCampaignsPanel — liste des campagnes d'une bibliothèque (refonte MID Glass).
 *
 * Préserve la logique métier : 1 seule campagne active à la fois (toggle isActive),
 * usagePolicy 5-state (cycle / cycle_per_account / once_per_account / once_global /
 * unlimited), edit inline de la policy, progress bar du cycle (usedInCycleCount /
 * total). Refonte UI/UX glass franc + primitives.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Trash2,
  ChevronRight,
  RotateCcw,
  Pencil,
  X,
  Check,
} from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Chip } from "@/components/ui/Chip";
import { Switch } from "@/components/ui/Switch";
import { EmptyState } from "@/components/ui/EmptyState";

// USAGE_POLICIES legacy 5-value enum DB. Conservé pour le mapping côté API.
// L'UI utilise désormais 2 dimensions (scope + maxUsage) cohérent avec MediaLibrary.
const USAGE_POLICIES = [
  {
    value: "cycle",
    label: "Cycle global",
    description:
      "Tour à tour. Une fois tout utilisé, reset manuel pour recommencer.",
  },
  {
    value: "cycle_per_account",
    label: "Cycle par compte",
    description:
      "Chaque compte tourne indépendamment. Recommence automatiquement quand tout est utilisé.",
  },
  {
    value: "once_per_account",
    label: "1 fois par compte",
    description:
      "Chaque compte peut utiliser chaque fiche max 1 fois. Rien de plus ensuite.",
  },
  {
    value: "once_global",
    label: "1 fois global",
    description:
      "Chaque fiche utilisée 1 fois par n'importe quel compte ne sera plus proposée.",
  },
  {
    value: "unlimited",
    label: "Sans limite",
    description: "Toujours la fiche la moins récemment utilisée. Aucun blocage.",
  },
] as const;

// Mapping bidirectionnel : usagePolicy ↔ { scope, maxUsage } pour aligner l'UX
// data sur celle de MediaLibrary (2 chips scope + input max).
type PolicyView = { scope: "per_account" | "shared"; maxUsage: number | null };

function policyToView(policy: string | null | undefined): PolicyView {
  switch (policy) {
    case "cycle_per_account": return { scope: "per_account", maxUsage: null };
    case "once_per_account":  return { scope: "per_account", maxUsage: 1 };
    case "once_global":       return { scope: "shared",      maxUsage: 1 };
    case "unlimited":         return { scope: "shared",      maxUsage: null };
    case "cycle":
    default:                  return { scope: "shared",      maxUsage: null };
  }
}

function viewToPolicy(view: PolicyView): string {
  // maxUsage = 1 → blocage strict après 1 utilisation (once_*)
  if (view.maxUsage === 1) {
    return view.scope === "per_account" ? "once_per_account" : "once_global";
  }
  // maxUsage vide (null) ou N>1 → pas de blocage par fiche.
  // - per_account : cycle auto-reset (cycle_per_account)
  // - shared      : pas de blocage du tout, toujours la moins récemment utilisée (unlimited).
  //   ⚠ on n'émet PLUS "cycle" depuis l'UI : "cycle" nécessite un reset manuel via /reset
  //   et n'a pas de représentation cohérente dans le couple (scope, maxUsage). Les campagnes
  //   legacy en "cycle" sont conservées en lecture (policyMeta affiche "Cycle global") mais
  //   ré-éditer + sauvegarder les migrera vers "unlimited" (équivalent fonctionnel sans reset).
  return view.scope === "per_account" ? "cycle_per_account" : "unlimited";
}


interface DataCampaign {
  id: string;
  name: string;
  isActive: boolean;
  cycleResetAt: string | null;
  createdAt: string;
  _count: { entries: number };
  usedInCycleCount: number;
  usagePolicy: string;
}

interface Props {
  libraryId: string;
  libraryName: string;
}

export function DataCampaignsPanel({ libraryId, libraryName: _libraryName }: Props) {
  void _libraryName;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [campaigns, setCampaigns] = useState<DataCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Create form state — utilise scope + maxUsage (UX cohérent media), mappé vers usagePolicy au save.
  const [form, setForm] = useState<{ name: string; isActive: boolean; scope: "per_account" | "shared"; maxUsage: string }>({
    name: "",
    isActive: false,
    scope: "shared",
    maxUsage: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  // Edit policy inline — utilise un state de view (scope + maxUsage) au lieu du usagePolicy direct.
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [editingPolicyView, setEditingPolicyView] = useState<PolicyView>({ scope: "shared", maxUsage: null });
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/libraries/data/${libraryId}/campaigns`);
      if (!res.ok) throw new Error(`Erreur serveur (HTTP ${res.status})`);
      const data = (await res.json()) as DataCampaign[];
      setCampaigns(data);
    } catch (err) {
      console.error("[DataCampaignsPanel] load error:", err);
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = campaigns.filter((c) => c.isActive).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      const maxUsageInt = form.maxUsage.trim() ? parseInt(form.maxUsage, 10) : null;
      const policyView: PolicyView = { scope: form.scope, maxUsage: maxUsageInt };
      const res = await fetch(`/api/admin/libraries/data/${libraryId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          isActive: form.isActive,
          usagePolicy: viewToPolicy(policyView),
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setCreateError(d.error ?? "Erreur");
        return;
      }
      const createdName = form.name;
      setCreating(false);
      resetForm();
      toast.success(`Campagne « ${createdName} » créée.`);
      void load();
    } catch {
      setCreateError("Erreur réseau");
    } finally {
      setCreateSaving(false);
    }
  }

  function resetForm() {
    setForm({ name: "", isActive: false, scope: "shared", maxUsage: "" });
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Supprimer la campagne « ${name} » ?`,
      description:
        "Toutes les entrées associées seront également supprimées. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/libraries/data/campaigns/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    void load();
  }

  async function handleToggleActive(campaign: DataCampaign) {
    setPendingToggleId(campaign.id);
    const newActive = !campaign.isActive;
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: newActive }),
    });
    setPendingToggleId(null);
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la mise à jour");
      return;
    }
    // Toast feedback explicite — l'isActive est exclusive (1 par lib), l'user doit
    // comprendre que les autres campagnes ont été désactivées en conséquence.
    if (newActive) {
      toast.success(`Campagne « ${campaign.name} » activée — les autres campagnes de la bibliothèque ont été désactivées`);
    } else {
      toast.info(`Campagne « ${campaign.name} » désactivée`);
    }
    void load();
  }

  async function handleSavePolicy(campaign: DataCampaign) {
    setPolicySaving(true);
    const res = await fetch(`/api/admin/libraries/data/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usagePolicy: viewToPolicy(editingPolicyView) }),
    });
    setPolicySaving(false);
    if (!res.ok) {
      const d = (await res.json()) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la mise à jour");
      return;
    }
    setEditingPolicyId(null);
    void load();
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-gray-600">
          {campaigns.length} campagne{campaigns.length !== 1 ? "s" : ""}
          {activeCount > 0 && (
            <>
              {" · "}
              <span className="text-sage-700 tabular-nums">
                {activeCount} active
              </span>
            </>
          )}
          <span className="text-gray-400 ml-2">
            (1 campagne active à la fois)
          </span>
        </p>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Nouvelle campagne
        </Button>
      </div>

      {/* Error */}
      {loadError && (
        <div className="rounded-xl bg-rose-50/70 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.22)]">
          <p className="text-[12.5px] font-semibold text-rose-900">
            Impossible de charger les campagnes
          </p>
          <p className="text-[11px] font-mono text-rose-800 mt-1">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] text-rose-700 underline mt-2"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Loading / Empty */}
      {loading ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] py-16 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] flex items-center justify-center text-gray-500 gap-3">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-[12.5px]">Chargement…</span>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <EmptyState
            icon={RotateCcw}
            title="Aucune campagne"
            description="Créez-en une et importez vos données pour démarrer un cycle de rotation."
            cta={{ label: "Nouvelle campagne", onClick: () => setCreating(true) }}
          />
        </div>
      ) : (
        (() => {
          const activeCampaign = campaigns.find((c) => c.isActive) ?? null;
          const inactiveCampaigns = campaigns.filter((c) => !c.isActive);
          const renderCard = (c: DataCampaign, variant: "hero" | "compact") => {
            const pct =
              c._count.entries > 0
                ? Math.round((c.usedInCycleCount / c._count.entries) * 100)
                : 0;
            const isEditingPolicy = editingPolicyId === c.id;
            const policyMeta = USAGE_POLICIES.find(
              (p) => p.value === (c.usagePolicy ?? "cycle"),
            );
            return (
              <CampaignCard
                key={c.id}
                c={c}
                pct={pct}
                variant={variant}
                pendingToggle={pendingToggleId === c.id}
                isEditingPolicy={isEditingPolicy}
                editingPolicyView={editingPolicyView}
                setEditingPolicyView={setEditingPolicyView}
                policyMeta={policyMeta}
                policySaving={policySaving}
                libraryId={libraryId}
                onToggle={() => void handleToggleActive(c)}
                onStartEditPolicy={() => {
                  setEditingPolicyId(c.id);
                  setEditingPolicyView(policyToView(c.usagePolicy ?? "cycle"));
                }}
                onCancelEditPolicy={() => setEditingPolicyId(null)}
                onSavePolicy={() => void handleSavePolicy(c)}
                onDelete={() => void handleDelete(c.id, c.name)}
              />
            );
          };
          return (
            <div className="space-y-5">
              {/* Hero card : campagne active. Si aucune active → encart guide. */}
              {activeCampaign ? (
                renderCard(activeCampaign, "hero")
              ) : (
                <div className="rounded-2xl bg-gradient-to-b from-peach-50/70 via-peach-50/45 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(221,140,90,0.22)] px-4 py-3 flex items-center gap-3">
                  <span className="shrink-0 h-8 w-8 rounded-full bg-peach-100 inline-flex items-center justify-center text-peach-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                    <RotateCcw size={14} />
                  </span>
                  <p className="text-[12.5px] text-peach-900 leading-tight">
                    <span className="font-semibold">Aucune campagne active.</span>{" "}
                    Active une campagne ci-dessous pour démarrer un cycle de rotation.
                  </p>
                </div>
              )}

              {/* Inactives en grid compact 2-3 cols. */}
              {inactiveCampaigns.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-500 pl-1">
                    {inactiveCampaigns.length} campagne{inactiveCampaigns.length > 1 ? "s" : ""} inactive{inactiveCampaigns.length > 1 ? "s" : ""}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {inactiveCampaigns.map((c) => renderCard(c, "compact"))}
                  </div>
                </div>
              )}
            </div>
          );
        })()
      )}

      {/* Modal création */}
      <Modal open={creating} onClose={() => !createSaving && setCreating(false)} size="md">
        <Modal.Header onClose={() => !createSaving && setCreating(false)}>
          Nouvelle campagne
        </Modal.Header>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="contents"
        >
          <Modal.Body>
            <div className="space-y-3">
              <FormField label="Nom" required>
                <Input
                  required
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="Ex: RPI Q1 2026"
                />
              </FormField>

              <FormField
                label="Comment les fiches tournent"
                help="Indépendant : chaque compte IG a son propre cycle. Partagé : tous les comptes consomment le même pool."
              >
                <div className="flex gap-1.5 flex-wrap">
                  {(["per_account", "shared"] as const).map((s) => (
                    <Chip
                      key={s}
                      variant={form.scope === s ? "sky" : "default"}
                      selected={form.scope === s}
                      onClick={() => setForm((f) => ({ ...f, scope: s }))}
                      size="md"
                    >
                      {s === "per_account" ? "Indépendant par compte" : "Partagé entre comptes"}
                    </Chip>
                  ))}
                </div>
              </FormField>

              <FormField
                label="Consommation max par fiche"
                help="Vide = infini · 1 = chaque fiche utilisée une seule fois (puis bloquée)."
              >
                <Input
                  type="number"
                  min={1}
                  max={1}
                  value={form.maxUsage}
                  onChange={(v) => {
                    // Clamp à {vide, 1} : le backend ne sait pas faire N>1.
                    const trimmed = v.trim();
                    if (!trimmed) return setForm((f) => ({ ...f, maxUsage: "" }));
                    setForm((f) => ({ ...f, maxUsage: "1" }));
                  }}
                  placeholder="Vide = infini"
                />
              </FormField>

              <div className="rounded-xl bg-white/40 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-gray-950">
                      Activer immédiatement
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      La campagne actuellement active (s&apos;il y en a une) sera désactivée.
                    </p>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                    size="sm"
                    accent="default"
                  />
                </div>
              </div>

              {createError && <p className="text-[11px] text-rose-700">{createError}</p>}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={createSaving}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" icon={Plus} loading={createSaving}>
              Créer
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}

// ─── CampaignCard ───────────────────────────────────────────────────────────

function CampaignCard({
  c,
  pct,
  variant,
  pendingToggle,
  isEditingPolicy,
  editingPolicyView,
  setEditingPolicyView,
  policyMeta,
  policySaving,
  libraryId,
  onToggle,
  onStartEditPolicy,
  onCancelEditPolicy,
  onSavePolicy,
  onDelete,
}: {
  c: DataCampaign;
  pct: number;
  /** "hero" : campagne active mise en avant (grande card, stats verticales).
      "compact" : campagne inactive (card discrète, bouton Activer principal). */
  variant: "hero" | "compact";
  pendingToggle: boolean;
  isEditingPolicy: boolean;
  editingPolicyView: PolicyView;
  setEditingPolicyView: (v: PolicyView) => void;
  policyMeta?: (typeof USAGE_POLICIES)[number];
  policySaving: boolean;
  libraryId: string;
  onToggle: () => void;
  onStartEditPolicy: () => void;
  onCancelEditPolicy: () => void;
  onSavePolicy: () => void;
  onDelete: () => void;
}) {
  const isHero = variant === "hero";

  // ─── HERO : campagne active proéminente ──────────────────────────────
  if (isHero) {
    return (
      <div className="group rounded-2xl bg-gradient-to-b from-sage-50/65 via-white/65 to-white/45 backdrop-blur-[14px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_2px_rgba(111,162,128,0.4),0_4px_12px_-4px_rgba(111,162,128,0.18),0_16px_32px_-12px_rgba(15,23,42,0.12)] p-5 space-y-4">
        {/* Header — badge active + actions */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-sage-700 inline-flex items-center gap-1.5">
              <Check size={11} /> Campagne active
            </p>
            <h2 className="mt-1 text-[22px] sm:text-[26px] font-semibold tracking-tight text-gray-950 leading-[1.1] truncate" title={c.name}>
              {c.name}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {pendingToggle ? (
              <span className="h-8 inline-flex items-center px-2 text-[11px] text-gray-500">
                <span className="h-3.5 w-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-2" />
                Désactivation…
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={onToggle}>
                Désactiver
              </Button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 text-gray-300 hover:text-rose-600 rounded-md hover:bg-rose-50/60 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              title="Supprimer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white/70 backdrop-blur-[8px] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.05)]">
            <p className="text-[9.5px] uppercase tracking-widest font-semibold text-gray-500">Fiches</p>
            <p className="text-[18px] font-semibold text-gray-950 tabular-nums leading-tight mt-0.5">{c._count.entries}</p>
          </div>
          <div className="rounded-xl bg-white/70 backdrop-blur-[8px] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.05)]">
            <p className="text-[9.5px] uppercase tracking-widest font-semibold text-gray-500">Utilisées</p>
            <p className="text-[18px] font-semibold text-gray-950 tabular-nums leading-tight mt-0.5">{c.usedInCycleCount}</p>
          </div>
          <div className="rounded-xl bg-white/70 backdrop-blur-[8px] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.05)]">
            <p className="text-[9.5px] uppercase tracking-widest font-semibold text-gray-500">Progression</p>
            <p className="text-[18px] font-semibold text-gray-950 tabular-nums leading-tight mt-0.5">{pct}%</p>
          </div>
        </div>

        {/* Progress bar */}
        {c._count.entries > 0 && (
          <div className="h-2 rounded-full overflow-hidden bg-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
            <div
              className={[
                "h-full rounded-full transition-all",
                pct >= 100 ? "bg-gradient-to-r from-sage-400 to-sage-500" : pct > 0 ? "bg-gradient-to-r from-sky-400 to-sky-500" : "bg-gray-200/60",
              ].join(" ")}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}

        {/* Policy + cycle reset info + main action */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1 space-y-1">
            {isEditingPolicy ? (
              <div className="rounded-xl bg-white/55 backdrop-blur-[8px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)] space-y-2.5">
                <div>
                  <p className="text-[9.5px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Comment elles tournent</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {(["per_account", "shared"] as const).map((s) => (
                      <Chip
                        key={s}
                        variant={editingPolicyView.scope === s ? "sky" : "default"}
                        selected={editingPolicyView.scope === s}
                        onClick={() => setEditingPolicyView({ ...editingPolicyView, scope: s })}
                        size="sm"
                      >
                        {s === "per_account" ? "Indépendant par compte" : "Partagé entre comptes"}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[9.5px] uppercase tracking-widest font-semibold text-gray-500 mb-1.5">Consommation max par fiche</p>
                  <input
                    type="number"
                    min={1}
                    max={1}
                    value={editingPolicyView.maxUsage ?? ""}
                    onChange={(e) => {
                      // Clamp à {vide, 1} : le backend ne supporte que ces deux valeurs.
                      const v = e.target.value.trim();
                      if (!v) return setEditingPolicyView({ ...editingPolicyView, maxUsage: null });
                      setEditingPolicyView({ ...editingPolicyView, maxUsage: 1 });
                    }}
                    placeholder="Vide = infini · 1 = bloquer après 1 usage"
                    className="w-full rounded-lg bg-white/65 backdrop-blur-[10px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)] px-2.5 py-1.5 text-[13px] text-gray-950 placeholder:text-gray-400 outline-none focus:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]"
                  />
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Button variant="primary" size="sm" icon={Check} onClick={onSavePolicy} loading={policySaving}>Enregistrer</Button>
                  <Button variant="ghost" size="sm" icon={X} onClick={onCancelEditPolicy}>
                    <span className="sr-only">Annuler</span>
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onStartEditPolicy}
                className="inline-flex items-center gap-1.5 text-[11px] text-sky-700 hover:text-sky-900 transition-colors"
                title={policyMeta?.description ?? ""}
              >
                <span className="font-medium">Rotation :</span>
                <span>{policyMeta?.label ?? c.usagePolicy}</span>
                <Pencil size={10} className="text-gray-300" />
              </button>
            )}
            {c.cycleResetAt && (
              <p className="text-[10.5px] text-gray-500">
                Dernier reset : {new Date(c.cycleResetAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" })}
              </p>
            )}
          </div>
          <Link
            href={`/admin/libraries/data/${libraryId}/${c.id}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-gradient-to-b from-gray-800 to-gray-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_4px_rgba(15,23,42,0.18)] hover:from-gray-900 hover:to-gray-950 transition-all"
          >
            Voir les fiches
            <ChevronRight size={13} />
          </Link>
        </div>
      </div>
    );
  }

  // ─── COMPACT : campagne inactive (card discrète) ──────────────────────
  return (
    <div className="group flex flex-col gap-2 p-3 rounded-xl bg-gradient-to-b from-white/75 to-white/45 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.1),0_2px_8px_-2px_rgba(15,23,42,0.08)] transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-800 truncate" title={c.name}>{c.name}</p>
          <p className="text-[10.5px] text-gray-500 tabular-nums mt-0.5">
            {c._count.entries} fiche{c._count.entries !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-gray-300 hover:text-rose-600 rounded-md transition-colors opacity-0 group-hover:opacity-100"
          title="Supprimer"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-auto pt-1">
        {pendingToggle ? (
          <span className="flex-1 h-7 inline-flex items-center justify-center text-[10.5px] text-gray-500">
            <span className="h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
            Activation…
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={onToggle} className="flex-1">
            Activer
          </Button>
        )}
        <Link
          href={`/admin/libraries/data/${libraryId}/${c.id}`}
          className="inline-flex items-center justify-center px-2 py-1.5 rounded-md text-[11px] font-medium text-gray-700 hover:text-gray-950 bg-white/60 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] transition-all"
          title="Voir les fiches"
        >
          <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  );
}
