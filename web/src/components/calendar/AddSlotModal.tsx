"use client";

/**
 * AddSlotModal — création de slot.
 *
 * Flux unique progressif (V1, 15/06) : compte requis → Recette optionnelle.
 * - Recette sélectionnée → planning et équipe pré-remplis (override possible via
 *   l'unlock heure existant ; reste à étendre en V3).
 * - Aucune recette → saisie libre avec champs override (cover/captions/desc).
 *
 * `selectedPatternId` est l'unique source de vérité du mode ; pas de `mode`
 * dupliqué côté state (anti-pattern qui avait causé Tabs "pattern"/"manual").
 *
 * Wrappers :
 * - Modal molecule (au lieu de fixed div)
 * - Combobox pour compte / preset / prompt
 * - DatePicker / TimePicker (zero-dep) pour planning
 * - FormField + Input pour le titre
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock, Users, Plus, Lock, Pencil } from "lucide-react";
import type { PublicationSlot } from "@/types/calendar";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { toast } from "@/components/ui/Toast";
import { formatNextActionLine } from "@/lib/publications/nextActionLabel";
import { SOURCE_LABELS_FR } from "@/lib/i18n/entityLabels";

interface Account {
  id: string;
  name: string;
  handle: string;
}

interface PatternOption {
  id: string;
  label: string;
  templateId?: string | null;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  source?: string;
  defaultAssigneeMonteur: { id: string; name: string } | null;
  defaultAssigneeCm: { id: string; name: string } | null;
  defaultAssigneeVideaste?: { id: string; name: string } | null;
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface AddSlotModalProps {
  accounts: Account[];
  defaultDate?: string;
  onCreated: (slot: PublicationSlot) => void;
  onClose: () => void;
}

const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const COVER_MODE_OPTIONS = [
  { value: "", label: "Hérite du pattern" },
  { value: "none", label: "Pas de cover" },
  { value: "manualSelect", label: "Sélection libre (CM)" },
  { value: "autoPack", label: "Pack auto → sélection (CM)" },
  { value: "monteurUpload", label: "Upload par le monteur" },
];

const DESCRIPTION_OPTIONS = [
  { value: "", label: "Aucune" },
  { value: "none", label: "Aucune" },
  { value: "preFilled", label: "Pré-remplie" },
  { value: "autoGenerate", label: "Auto-générée" },
  { value: "manualWrite", label: "Manuelle" },
];

// P0 — BOOL_OVERRIDE_OPTIONS retiré : OneOffToggle utilise maintenant un
// segmented tri-état natif (Défaut / Oui / Non) au lieu d'un Combobox.

export function AddSlotModal({
  accounts,
  defaultDate,
  onCreated,
  onClose,
}: AddSlotModalProps) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("19:00");
  const [title, setTitle] = useState("");

  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [selectedPatternId, setSelectedPatternId] = useState<string>("");
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  const [assigneeMonteurId, setAssigneeMonteurId] = useState<string>("");
  const [assigneeCmId, setAssigneeCmId] = useState<string>("");
  const [assigneeVideasteId, setAssigneeVideasteId] = useState<string>("");

  // P1 — En mode pattern, l'heure est verrouillée sur pattern.publishTime
  // par défaut. Cliquer "Modifier" déverrouille le TimePicker et affiche le
  // warning F1 (slot off-pattern). Évite la friction du picker libre tout en
  // gardant l'override possible.
  const [timeUnlocked, setTimeUnlocked] = useState(false);

  const [oneOffNeedsCaptions, setOneOffNeedsCaptions] = useState<boolean | null>(null);
  // P0 — toggle "Rushes attendus" retiré de l'UI (dérivé de source). On garde
  // le state à null pour ne jamais envoyer needsRushesOverride côté API.
  const [oneOffNeedsRushes] = useState<boolean | null>(null);
  const [oneOffNeedsBrief, setOneOffNeedsBrief] = useState<boolean | null>(null);
  const [oneOffCoverMode, setOneOffCoverMode] = useState<string>("");
  const [oneOffCaptionPresetId, setOneOffCaptionPresetId] = useState<string>("");
  const [oneOffNeedsDescription, setOneOffNeedsDescription] = useState<string>("");
  const [oneOffDescriptionPromptId, setOneOffDescriptionPromptId] = useState<string>("");

  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [captionPresets, setCaptionPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [descriptionPrompts, setDescriptionPrompts] = useState<Array<{ id: string; name: string }>>([]);
  const [coverPresets, setCoverPresets] = useState<Array<{ id: string; name: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Load meta ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [usersRes, presetsRes, promptsRes] = await Promise.all([
          fetch("/api/admin/users"),
          fetch("/api/caption-presets"),
          fetch("/api/description/prompts"),
        ]);
        if (cancelled) return;
        if (usersRes.ok) {
          setUsers((await usersRes.json()) as UserOption[]);
        }
        if (presetsRes.ok) {
          setCaptionPresets((await presetsRes.json()) as Array<{ id: string; name: string }>);
        }
        if (promptsRes.ok) {
          const prompts = (await promptsRes.json()) as Array<{
            id: string;
            name: string;
            isActive: boolean;
          }>;
          setDescriptionPrompts(prompts.filter((p) => p.isActive));
        }
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Patterns du compte ─────────────────────────────────────────────────
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoadingPatterns(true);
    setSelectedPatternId("");
    setAssigneeMonteurId("");
    setAssigneeCmId("");
    setAssigneeVideasteId("");

    // P2 — Fetch bindings au lieu de AccountPattern legacy. Le shim de compat
    // côté createSlot accepte encore patternId, mais l'UI envoie maintenant
    // l'id du binding (canonique) → moins de résolution implicite côté serveur.
    type BindingResponse = {
      id: string;
      customLabel: string | null;
      dayOfWeek: number[];
      publishTime: string;
      isActive: boolean;
      templateIdOverride: string | null;
      defaultAssigneeMonteur: { id: string; name: string } | null;
      defaultAssigneeCm: { id: string; name: string } | null;
      defaultAssigneeVideaste: { id: string; name: string } | null;
      patternTemplate: {
        id: string;
        label: string;
        source: string;
        templateId: string | null;
      };
    };
    // Au changement de compte, re-lock l'heure : on charge un nouveau pattern
    // par défaut, son publishTime devient la valeur affichée verrouillée.
    setTimeUnlocked(false);
    void fetch(`/api/admin/accounts/${accountId}/bindings`)
      .then((r) => (r.ok ? (r.json() as Promise<BindingResponse[]>) : []))
      .then((data) => {
        if (cancelled) return;
        const active: PatternOption[] = data
          .filter((b) => b.isActive)
          .map((b) => ({
            id: b.id,
            label: b.customLabel ?? b.patternTemplate.label,
            templateId: b.templateIdOverride ?? b.patternTemplate.templateId,
            dayOfWeek: b.dayOfWeek,
            publishTime: b.publishTime,
            isActive: b.isActive,
            source: b.patternTemplate.source,
            defaultAssigneeMonteur: b.defaultAssigneeMonteur,
            defaultAssigneeCm: b.defaultAssigneeCm,
            defaultAssigneeVideaste: b.defaultAssigneeVideaste,
          }));
        setPatterns(active);
        if (active.length > 0) {
          const first = active[0];
          setSelectedPatternId(first.id);
          setAssigneeMonteurId(first.defaultAssigneeMonteur?.id ?? "");
          setAssigneeCmId(first.defaultAssigneeCm?.id ?? "");
          setAssigneeVideasteId(first.defaultAssigneeVideaste?.id ?? "");
          if (first.publishTime) setTime(first.publishTime);
        }
        // Si aucune recette pour ce compte, selectedPatternId reste "" →
        // formulaire en mode libre automatiquement (pas besoin de mode).
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingPatterns(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // ─── Cover presets ──────────────────────────────────────────────────────
  useEffect(() => {
    const tplId = patterns.find((p) => p.id === selectedPatternId)?.templateId ?? null;
    if (!tplId) {
      setCoverPresets([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/templates/${tplId}/cover-presets`)
      .then((r) =>
        r.ok ? (r.json() as Promise<Array<{ id: string; name: string }>>) : [],
      )
      .then((data) => {
        if (!cancelled) setCoverPresets(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [patterns, selectedPatternId]);

  function handlePatternSelect(patternId: string) {
    setSelectedPatternId(patternId);
    const pattern = patterns.find((p) => p.id === patternId);
    if (pattern) {
      setAssigneeMonteurId(pattern.defaultAssigneeMonteur?.id ?? "");
      setAssigneeCmId(pattern.defaultAssigneeCm?.id ?? "");
      setAssigneeVideasteId(pattern.defaultAssigneeVideaste?.id ?? "");
      if (pattern.publishTime) {
        setTime(pattern.publishTime);
        // Re-locker l'heure quand on change de pattern : la valeur revient à
        // celle du pattern, l'admin doit re-cliquer "Modifier" pour la dévier.
        setTimeUnlocked(false);
      }
    }
  }

  const monteurs = useMemo(
    () => users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"),
    [users],
  );
  const cms = useMemo(
    () => users.filter((u) => u.role === "CM" || u.role === "ADMIN"),
    [users],
  );
  const videastes = useMemo(
    () => users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN"),
    [users],
  );

  const hasNoPatterns = !loadingPatterns && patterns.length === 0 && !!accountId;
  // Mode dérivé : recette sélectionnée = mode pattern, sinon mode libre.
  const isPatternMode = !!selectedPatternId;

  const canSubmit = useCallback(() => {
    if (!accountId) return false;
    if (isPatternMode) return !!selectedPatternId;
    if (!title.trim()) return false;
    if (oneOffCoverMode === "autoPack" && coverPresets.length === 0) return false;
    if (oneOffNeedsCaptions === true && !oneOffCaptionPresetId) return false;
    if (oneOffNeedsDescription === "autoGenerate" && !oneOffDescriptionPromptId) return false;
    return true;
  }, [
    accountId,
    isPatternMode,
    selectedPatternId,
    title,
    oneOffCoverMode,
    coverPresets.length,
    oneOffNeedsCaptions,
    oneOffCaptionPresetId,
    oneOffNeedsDescription,
    oneOffDescriptionPromptId,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (isPatternMode && loadingPatterns) {
      setError("Chargement des patterns du compte en cours…");
      return;
    }
    if (!canSubmit()) {
      setError(isPatternMode ? "Sélectionne un pattern." : "Renseigne au moins un titre.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      const payload: Record<string, unknown> = {
        accountId,
        scheduledAt,
        title: title || null,
        assigneeMonteurId: assigneeMonteurId || null,
        assigneeCmId: assigneeCmId || null,
        assigneeVideasteId: assigneeVideasteId || null,
        // P2 — selectedPatternId est désormais un id de PatternBinding.
        // createSlot l'accepte directement via patternBindingId.
        patternBindingId: isPatternMode ? selectedPatternId : null,
      };

      if (!isPatternMode) {
        if (oneOffNeedsCaptions !== null) payload.needsCaptionsOverride = oneOffNeedsCaptions;
        if (oneOffNeedsRushes !== null) payload.needsRushesOverride = oneOffNeedsRushes;
        if (oneOffNeedsBrief !== null) payload.needsBriefOverride = oneOffNeedsBrief;
        if (oneOffCoverMode) payload.coverModeOverride = oneOffCoverMode;
        if (oneOffCaptionPresetId) payload.captionPresetIdOverride = oneOffCaptionPresetId;
        if (oneOffNeedsDescription) payload.needsDescriptionOverride = oneOffNeedsDescription;
        if (oneOffDescriptionPromptId) payload.descriptionPromptIdOverride = oneOffDescriptionPromptId;
      }

      const res = await fetch("/api/calendar/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la création");
      }
      const slot = (await res.json()) as PublicationSlot;

      // Phase 3 — Friction HIGH #4 du audit UX : avant on fermait la modal
      // sans aucun signal. L'admin ne savait pas si un job auto allait se
      // déclencher, ni à qui l'attribuer ensuite. Désormais toast contextuel
      // basé sur l'état initial du slot (issu de mapSourceToInitialStatus).
      const nextActionLine = formatNextActionLine(slot.status, {
        assigneeMonteurId: slot.assigneeMonteurId ?? null,
        assigneeCmId: slot.assigneeCmId ?? null,
        assigneeVideasteId: slot.assigneeVideasteId ?? null,
        assigneeMonteurName: slot.assigneeMonteur?.name ?? null,
        assigneeCmName: slot.assigneeCm?.name ?? null,
        assigneeVideasteName: slot.assigneeVideaste?.name ?? null,
      });
      toast.success(
        nextActionLine ? `Slot créé — ${nextActionLine}` : "Slot créé",
      );

      onCreated(slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const selectedPattern = patterns.find((p) => p.id === selectedPatternId);

  // ─── Options pour Combobox ──────────────────────────────────────────────
  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `@${a.handle} — ${a.name}`,
    keywords: [a.handle, a.name],
  }));

  const videasteOptions = [
    { value: "", label: "— Aucun —" },
    ...videastes.map((u) => ({ value: u.id, label: u.name })),
  ];
  const monteurOptions = [
    { value: "", label: "— Aucun —" },
    ...monteurs.map((u) => ({ value: u.id, label: u.name })),
  ];
  const cmOptions = [
    { value: "", label: "— Aucun —" },
    ...cms.map((u) => ({ value: u.id, label: u.name })),
  ];

  // P1 — Les assignations sont-elles déjà pré-remplies depuis le pattern ?
  // Si oui, la section "Équipe" peut rester repliée par défaut (modifier
  // assignation = action rare). Si non (mode manuel), section ouverte.
  const teamPrefilledFromPattern =
    isPatternMode &&
    !!selectedPattern &&
    ((!!selectedPattern.defaultAssigneeMonteur && !!assigneeMonteurId) ||
      (!!selectedPattern.defaultAssigneeCm && !!assigneeCmId) ||
      (!!selectedPattern.defaultAssigneeVideaste && !!assigneeVideasteId));

  return (
    <Modal open onClose={onClose} size="lg">
      <Modal.Header onClose={onClose}>Nouveau slot</Modal.Header>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="contents"
      >
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-4">
          <FormField label="Compte Instagram" required>
            <Combobox
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder="Choisir un compte"
            />
          </FormField>

          {/* Toggle "Sans recette" — bascule entre flux pattern (recette
              sélectionnée + champs pré-remplis verrouillés) et flux libre
              (saisie complète avec overrides). Discret par défaut. */}
          {!hasNoPatterns && patterns.length > 0 && (
            <div className="flex items-center justify-end -mt-1">
              <button
                type="button"
                onClick={() => {
                  if (selectedPatternId) {
                    // Mode pattern → mode libre : on clear la sélection ; les
                    // overrides restent à leur défaut neutre (l'admin saisit).
                    setSelectedPatternId("");
                    setAssigneeMonteurId("");
                    setAssigneeCmId("");
                    setAssigneeVideasteId("");
                    setTimeUnlocked(true);
                  } else if (patterns[0]) {
                    // Mode libre → mode pattern : re-sélectionne la première.
                    handlePatternSelect(patterns[0].id);
                  }
                }}
                className="text-[11px] text-muted-foreground hover:text-gray-800 hover:underline"
              >
                {selectedPatternId ? "Créer sans recette →" : "← Utiliser une recette"}
              </button>
            </div>
          )}

          {/* Mode PATTERN — picker visuel */}
          {isPatternMode && (
            <FormField
              label="Recette"
              required
              help="La recette fixe le template, les sous-titres et la cover par défaut."
            >
              {loadingPatterns ? (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-2">
                  <div className="w-4 h-4 border-2 border-info-200 border-t-transparent rounded-full animate-spin" />
                  Chargement…
                </div>
              ) : (
                <div className="space-y-1.5">
                  {patterns.map((p) => {
                    const isSelected = p.id === selectedPatternId;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => handlePatternSelect(p.id)}
                        className={[
                          "w-full text-left p-3 rounded-xl transition-all",
                          "bg-card border border-border",
                          isSelected
                            ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.5),0_4px_12px_-2px_rgba(125,180,210,0.25)]"
                            : " hover:",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-foreground">
                            {p.label}
                          </span>
                          {p.source && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-50/70 text-danger-700 shadow-[inset_0_0_0_1px_rgba(201,113,133,0.18)]">
                              {SOURCE_LABELS_FR[p.source] ?? p.source}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            {p.dayOfWeek.length === 0
                              ? "Pattern manuel (pas de planning auto)"
                              : `${p.dayOfWeek.map((d) => DAYS[d] ?? `J${d}`).join("/")} · ${p.publishTime}`}
                          </span>
                          {(p.defaultAssigneeVideaste ||
                            p.defaultAssigneeMonteur ||
                            p.defaultAssigneeCm) && (
                            <span className="inline-flex items-center gap-1">
                              <Users size={11} />
                              {[
                                p.defaultAssigneeVideaste?.name,
                                p.defaultAssigneeMonteur?.name,
                                p.defaultAssigneeCm?.name,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </FormField>
          )}

          {/* Info pas de pattern */}
          {hasNoPatterns && (
            <div className="flex items-start gap-2 rounded-xl bg-warning-50/70 px-3 py-2.5 text-[12px] text-warning-700 ">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                Pas de pattern actif sur ce compte. Tu peux créer un slot manuel, ou{" "}
                <Link
                  href={`/admin/accounts/${accountId}`}
                  target="_blank"
                  className="underline hover:text-warning-700"
                >
                  configurer un pattern
                </Link>
                .
              </span>
            </div>
          )}

          {/* Date + Heure — en mode pattern l'heure est lockée sur
              pattern.publishTime ; un clic "Modifier" déverrouille le picker. */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required>
              <DatePicker value={date} onChange={setDate} />
            </FormField>
            <FormField label="Heure" required>
              {isPatternMode && selectedPattern?.publishTime && !timeUnlocked ? (
                <div className="flex items-center gap-2 h-9 rounded-md px-3 bg-card border border-border ">
                  <Lock size={11} className="text-muted-foreground" />
                  <span className="text-[13px] font-mono tabular-nums text-gray-800">
                    {selectedPattern.publishTime}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTimeUnlocked(true)}
                    className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-info-700 hover:text-info-700 hover:underline"
                  >
                    <Pencil size={10} />
                    Modifier
                  </button>
                </div>
              ) : (
                <TimePicker value={time} onChange={setTime} />
              )}
            </FormField>
          </div>

          {/* F1 — Warning si l'admin a déverrouillé l'heure et choisi une
              valeur off-pattern : la clé d'idempotence de generateCalendarSlots
              inclut scheduledAt, donc un slot one-off à une heure différente
              coexistera avec celui auto-généré. */}
          {isPatternMode &&
            timeUnlocked &&
            selectedPattern?.publishTime &&
            time !== selectedPattern.publishTime && (
              <div className="rounded-xl bg-gradient-to-b from-warning-50/85 to-warning-50/55 px-4 py-3 ">
                <p className="text-[12px] text-warning-700">
                  <span className="font-semibold">Heure différente du pattern</span>{" "}
                  ({selectedPattern.publishTime}). Le slot sera créé à {time}. Si tu génères
                  la semaine plus tard, un autre slot pourrait être ajouté à{" "}
                  {selectedPattern.publishTime}.
                </p>
              </div>
            )}

          {/* Titre */}
          <FormField
            label="Titre"
            required={!isPatternMode}
            help={
              isPatternMode
                ? "Optionnel : surcharge le label du pattern."
                : "Nom du bien, propriétaire, sujet…"
            }
          >
            <Input
              value={title}
              onChange={setTitle}
              placeholder={
                isPatternMode
                  ? selectedPattern?.label ?? "(pattern par défaut)"
                  : "Visite — Appartement Bordeaux"
              }
            />
          </FormField>

          {/* Équipe assignée — repliée par défaut quand pré-remplie depuis
              le pattern (action rare). Ouverte en mode manuel ou si aucun
              défaut. Le warning "sans monteur" reste visible hors collapse
              car bloquant (slot non assigné = invisible côté monteur). */}
          {!assigneeMonteurId && (
            <div className="flex items-start gap-2 text-[11px] text-warning-700 bg-warning-50/70 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.18)]">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              Sans monteur assigné, ce slot n&apos;apparaîtra dans la worklist d&apos;aucun
              monteur.
            </div>
          )}
          <CollapsibleSection
            title={
              isPatternMode
                ? "Équipe assignée · pré-remplie depuis le pattern"
                : "Équipe assignée"
            }
            defaultOpen={!teamPrefilledFromPattern}
            storageKey="add-slot-modal:team"
          >
            <div className="grid grid-cols-2 gap-3 pt-1">
              <FormField label="Vidéaste">
                <Combobox
                  value={assigneeVideasteId}
                  onChange={setAssigneeVideasteId}
                  options={videasteOptions}
                  placeholder="— Aucun —"
                  disabled={loadingMeta}
                />
              </FormField>
              <FormField label="Monteur">
                <Combobox
                  value={assigneeMonteurId}
                  onChange={setAssigneeMonteurId}
                  options={monteurOptions}
                  placeholder="— Aucun —"
                  disabled={loadingMeta}
                />
              </FormField>
              <div className="col-span-2">
                <FormField label="Community manager">
                  <Combobox
                    value={assigneeCmId}
                    onChange={setAssigneeCmId}
                    options={cmOptions}
                    placeholder="— Aucun —"
                    disabled={loadingMeta}
                  />
                </FormField>
              </div>
            </div>
          </CollapsibleSection>

          {/* Options de production (manuel only) — repliée par défaut,
              avec defaults raisonnables (tout hérite du pattern si renseigné
              plus tard). L'admin l'ouvre seulement s'il veut vraiment fixer
              les choses dès la création. */}
          {!isPatternMode && (
            <CollapsibleSection
              title="Options de production · cover, sous-titres, description"
              defaultOpen={false}
              storageKey="add-slot-modal:options"
            >
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tout reste modifiable après création depuis la fiche.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <FormField label="Cover automatique">
                  <Combobox
                    value={oneOffCoverMode}
                    onChange={setOneOffCoverMode}
                    options={COVER_MODE_OPTIONS}
                    placeholder="Hérite de la recette"
                  />
                </FormField>
                <OneOffToggle
                  label="Sous-titres auto"
                  value={oneOffNeedsCaptions}
                  onChange={setOneOffNeedsCaptions}
                />
                {/* P0 — "Rushes attendus" retiré : la valeur est dérivée
                    de la source du pattern (manual_rushes → true). Pour un
                    slot one-off sans pattern, par défaut pas de rushs. */}
                <OneOffToggle
                  label="Brief éditorial"
                  value={oneOffNeedsBrief}
                  onChange={setOneOffNeedsBrief}
                />
              </div>

              {oneOffCoverMode === "autoPack" && coverPresets.length === 0 && (
                <p className="text-[11px] text-warning-700 bg-warning-50/70 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.2)]">
                  Aucune config cover sur ce template. Active-la dans le builder
                  (onglet « Cover auto ») avant de créer ce slot.
                </p>
              )}

              {oneOffNeedsCaptions === true && (
                <FormField label="Preset captions" required>
                  <Combobox
                    value={oneOffCaptionPresetId}
                    onChange={setOneOffCaptionPresetId}
                    options={[
                      { value: "", label: "— Choisir un preset —" },
                      ...captionPresets.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                </FormField>
              )}

              <div className="grid grid-cols-2 gap-2">
                <FormField label="Mode description">
                  <Combobox
                    value={oneOffNeedsDescription}
                    onChange={setOneOffNeedsDescription}
                    options={DESCRIPTION_OPTIONS}
                  />
                </FormField>
                {oneOffNeedsDescription === "autoGenerate" && (
                  <FormField label="Prompt IA" required>
                    <Combobox
                      value={oneOffDescriptionPromptId}
                      onChange={setOneOffDescriptionPromptId}
                      options={[
                        { value: "", label: "— Choisir un prompt —" },
                        ...descriptionPrompts.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </FormField>
                )}
              </div>
            </CollapsibleSection>
          )}

          {error && (
            <p className="text-[12px] text-danger-700 bg-danger-50/80 rounded-md px-3 py-2 ">
              {error}
            </p>
          )}
        </div>

        <Modal.Footer>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Plus}
            loading={saving}
            disabled={!canSubmit() || loadingMeta || loadingPatterns}
          >
            {saving ? "Création…" : "Créer le slot"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}

// ─── OneOffToggle (segmented tri-état) ────────────────────────────────────
//
// Tri-état lisible : Défaut / Oui / Non rendu en boutons segmentés au lieu
// d'un Combobox 3 options. Le sens "hérité du pattern" (null) reste explicite
// via le label "Défaut" — choisir Oui ou Non force la valeur sur ce slot.

function OneOffToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const options: { key: "default" | "true" | "false"; label: string; v: boolean | null }[] = [
    { key: "default", label: "Défaut", v: null },
    { key: "true", label: "Oui", v: true },
    { key: "false", label: "Non", v: false },
  ];
  const current = value === null ? "default" : value ? "true" : "false";
  return (
    <FormField label={label}>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex items-center rounded-lg p-0.5 bg-card border border-border "
      >
        {options.map((opt) => {
          const active = current === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.v)}
              className={[
                "px-3 h-7 text-[12px] font-medium rounded-md transition-all",
                active
                  ? "bg-gray-900 text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                  : "text-muted-foreground hover:text-gray-900 hover:bg-white/80",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </FormField>
  );
}
