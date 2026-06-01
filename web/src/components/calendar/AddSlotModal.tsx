"use client";

/**
 * AddSlotModal — création de slot (Phase 8 refonte Liquid Glass MID).
 *
 * Wrappers :
 * - Modal molecule (au lieu de fixed div)
 * - Tabs primitive pour "Depuis un pattern" vs "Manuel one-off"
 * - Combobox pour compte / preset / prompt
 * - DatePicker / TimePicker (zero-dep) pour planning
 * - FormField + Input pour le titre
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Sparkles, PenLine, Clock, Users, Plus } from "lucide-react";
import type { PublicationSlot } from "@/types/calendar";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { toast } from "@/components/ui/Toast";
import { formatNextActionLine } from "@/lib/publications/nextActionLabel";

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

type Mode = "pattern" | "manual";

const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Template auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

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

const BOOL_OVERRIDE_OPTIONS = [
  { value: "default", label: "Défaut (non)" },
  { value: "true", label: "Forcer : Oui" },
  { value: "false", label: "Forcer : Non" },
];

export function AddSlotModal({
  accounts,
  defaultDate,
  onCreated,
  onClose,
}: AddSlotModalProps) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10);

  const [mode, setMode] = useState<Mode>("pattern");

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

  const [oneOffNeedsCaptions, setOneOffNeedsCaptions] = useState<boolean | null>(null);
  const [oneOffNeedsRushes, setOneOffNeedsRushes] = useState<boolean | null>(null);
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

    void fetch(`/api/admin/accounts/${accountId}/patterns`)
      .then((r) => (r.ok ? (r.json() as Promise<PatternOption[]>) : []))
      .then((data) => {
        if (cancelled) return;
        const active = data.filter((p) => p.isActive);
        setPatterns(active);
        if (active.length > 0) {
          const first = active[0];
          setSelectedPatternId(first.id);
          setAssigneeMonteurId(first.defaultAssigneeMonteur?.id ?? "");
          setAssigneeCmId(first.defaultAssigneeCm?.id ?? "");
          setAssigneeVideasteId(first.defaultAssigneeVideaste?.id ?? "");
          if (first.publishTime) setTime(first.publishTime);
        } else if (mode === "pattern") {
          setMode("manual");
        }
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
      if (pattern.publishTime) setTime(pattern.publishTime);
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
  const isPatternMode = mode === "pattern" && !hasNoPatterns;

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
        patternId: isPatternMode ? selectedPatternId : null,
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

  const tabItems: { id: Mode; label: string; icon: typeof Sparkles; disabled?: boolean }[] = [
    { id: "pattern", label: "Depuis un pattern", icon: Sparkles, disabled: hasNoPatterns },
    { id: "manual", label: "Manuel (one-off)", icon: PenLine },
  ];

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
          <Tabs
            items={tabItems}
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            variant="glass"
            size="sm"
          />

          <FormField label="Compte Instagram" required>
            <Combobox
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
              placeholder="Choisir un compte"
            />
          </FormField>

          {/* Mode PATTERN — picker visuel */}
          {isPatternMode && (
            <FormField
              label="Pattern"
              required
              help="Le pattern fixe le template, les sous-titres et la cover par défaut."
            >
              {loadingPatterns ? (
                <div className="flex items-center gap-2 text-[12px] text-gray-400 py-2">
                  <div className="w-4 h-4 border-2 border-sky-300 border-t-transparent rounded-full animate-spin" />
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
                          "bg-white/60 backdrop-blur-[8px]",
                          isSelected
                            ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_2px_rgba(77,150,191,0.5),0_4px_12px_-2px_rgba(125,180,210,0.25)]"
                            : "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.08)]",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-gray-950">
                            {p.label}
                          </span>
                          {p.source && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50/70 text-rose-700 shadow-[inset_0_0_0_1px_rgba(201,113,133,0.18)]">
                              {SOURCE_LABEL[p.source] ?? p.source}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
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
            <div className="flex items-start gap-2 rounded-xl bg-peach-50/70 backdrop-blur-[8px] px-3 py-2.5 text-[12px] text-peach-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(245,158,107,0.2)]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                Pas de pattern actif sur ce compte. Tu peux créer un slot manuel, ou{" "}
                <Link
                  href={`/admin/accounts/${accountId}`}
                  target="_blank"
                  className="underline hover:text-peach-900"
                >
                  configurer un pattern
                </Link>
                .
              </span>
            </div>
          )}

          {/* Date + Heure */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required>
              <DatePicker value={date} onChange={setDate} />
            </FormField>
            <FormField label="Heure" required>
              <TimePicker value={time} onChange={setTime} />
            </FormField>
          </div>

          {/* F1 — Warning si scheduledAt off-pattern : la clé d'idempotence
              de generateCalendarSlots inclut scheduledAt, donc un slot one-off
              à une heure différente coexistera avec celui auto-généré. */}
          {isPatternMode && selectedPattern?.publishTime && time !== selectedPattern.publishTime && (
            <div className="rounded-xl bg-gradient-to-b from-peach-50/85 to-peach-50/55 backdrop-blur-[10px] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(245,158,107,0.30)]">
              <p className="text-[12px] text-peach-900">
                <span className="font-semibold">Heure différente du pattern</span> ({selectedPattern.publishTime}).
                Le slot sera créé à {time}. Si tu génères la semaine plus tard, un autre slot pourrait être ajouté à {selectedPattern.publishTime}.
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

          {/* Assignés (commun) */}
          <div className="rounded-xl bg-white/40 backdrop-blur-[8px] p-3 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-medium text-gray-500">
              <Users size={11} />
              Équipe assignée
              {isPatternMode && (
                <span className="ml-1 normal-case tracking-normal text-[10px] text-gray-400 font-normal">
                  pré-remplie depuis le pattern · modifiable
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            {!assigneeMonteurId && (
              <div className="flex items-start gap-2 text-[11px] text-peach-700 bg-peach-50/70 rounded-md px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.18)]">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                Sans monteur assigné, ce slot n&apos;apparaîtra dans la worklist d&apos;aucun
                monteur.
              </div>
            )}
          </div>

          {/* Options de production (manuel only) — remplacé details/summary
              natif (anti-pattern) par un bloc inline. La section est courte
              et toujours utile en mode manuel, pas la peine de la masquer. */}
          {!isPatternMode && (
            <section className="rounded-xl bg-rose-50/40 backdrop-blur-[8px] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.18)] space-y-3">
              <div>
                <h3 className="text-[12px] font-semibold text-rose-700">
                  Options de production
                </h3>
                <p className="mt-0.5 text-[11px] text-rose-700/70">
                  Pré-régler cover, sous-titres, description (laisser vide = héritera du pattern par défaut).
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Cover automatique">
                  <Combobox
                    value={oneOffCoverMode}
                    onChange={setOneOffCoverMode}
                    options={COVER_MODE_OPTIONS}
                    placeholder="Hérite du pattern"
                  />
                </FormField>
                <OneOffToggle
                  label="Sous-titres auto"
                  value={oneOffNeedsCaptions}
                  onChange={setOneOffNeedsCaptions}
                />
                <OneOffToggle
                  label="Rushes attendus"
                  value={oneOffNeedsRushes}
                  onChange={setOneOffNeedsRushes}
                />
                <OneOffToggle
                  label="Brief éditorial"
                  value={oneOffNeedsBrief}
                  onChange={setOneOffNeedsBrief}
                />
              </div>

              {oneOffCoverMode === "autoPack" && coverPresets.length === 0 && (
                <p className="text-[11px] text-peach-700 bg-peach-50/70 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.2)]">
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
            </section>
          )}

          {error && (
            <p className="text-[12px] text-rose-700 bg-rose-50/80 backdrop-blur-[8px] rounded-md px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.18)]">
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

// ─── OneOffToggle (Combobox version) ────────────────────────────────────────

function OneOffToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const selectValue = value === null ? "default" : value ? "true" : "false";
  return (
    <FormField label={label}>
      <Combobox
        value={selectValue}
        onChange={(v) => {
          onChange(v === "default" ? null : v === "true");
        }}
        options={BOOL_OVERRIDE_OPTIONS}
      />
    </FormField>
  );
}
