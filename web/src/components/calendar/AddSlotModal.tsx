"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Plus, X, AlertCircle, Sparkles, PenLine, Clock, Users } from "lucide-react";
import Link from "next/link";
import type { PublicationSlot } from "@/types/calendar";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";

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
const SELECT_CLS =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white";

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Template auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

export function AddSlotModal({ accounts, defaultDate, onCreated, onClose }: AddSlotModalProps) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10);

  // Mode (tab actif)
  const [mode, setMode] = useState<Mode>("pattern");

  // Form base
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("19:00");
  const [title, setTitle] = useState("");

  // Pattern picker
  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [selectedPatternId, setSelectedPatternId] = useState<string>("");
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  // Assignees
  const [assigneeMonteurId, setAssigneeMonteurId] = useState<string>("");
  const [assigneeCmId, setAssigneeCmId] = useState<string>("");
  const [assigneeVideasteId, setAssigneeVideasteId] = useState<string>("");

  // Overrides one-off (Manuel)
  const [oneOffNeedsCaptions, setOneOffNeedsCaptions] = useState<boolean | null>(null);
  const [oneOffNeedsRushes, setOneOffNeedsRushes] = useState<boolean | null>(null);
  const [oneOffNeedsBrief, setOneOffNeedsBrief] = useState<boolean | null>(null);
  const [oneOffCoverMode, setOneOffCoverMode] = useState<string>("");
  const [oneOffCoverPresetId, setOneOffCoverPresetId] = useState<string>("");
  const [oneOffCaptionPresetId, setOneOffCaptionPresetId] = useState<string>("");
  const [oneOffNeedsDescription, setOneOffNeedsDescription] = useState<string>("");
  const [oneOffDescriptionPromptId, setOneOffDescriptionPromptId] = useState<string>("");

  // Meta data
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [captionPresets, setCaptionPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [descriptionPrompts, setDescriptionPrompts] = useState<Array<{ id: string; name: string }>>([]);
  const [coverPresets, setCoverPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingCoverPresets, setLoadingCoverPresets] = useState(false);

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
          setUsers(await usersRes.json() as UserOption[]);
        }
        if (presetsRes.ok) {
          setCaptionPresets(await presetsRes.json() as Array<{ id: string; name: string }>);
        }
        if (promptsRes.ok) {
          const prompts = await promptsRes.json() as Array<{ id: string; name: string; isActive: boolean }>;
          setDescriptionPrompts(prompts.filter((p) => p.isActive));
        }
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => { cancelled = true; };
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
      .then((r) => (r.ok ? r.json() as Promise<PatternOption[]> : []))
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
          // Pré-remplit l'heure depuis le pattern
          if (first.publishTime) setTime(first.publishTime);
        } else if (mode === "pattern") {
          // Pas de pattern actif → bascule en manuel automatiquement
          setMode("manual");
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingPatterns(false); });

    return () => { cancelled = true; };
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
    setLoadingCoverPresets(true);
    void fetch(`/api/templates/${tplId}/cover-presets`)
      .then((r) => (r.ok ? r.json() as Promise<Array<{ id: string; name: string }>> : []))
      .then((data) => { if (!cancelled) setCoverPresets(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCoverPresets(false); });
    return () => { cancelled = true; };
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

  // Filtrage des users par rôle
  const monteurs = useMemo(() => users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN"), [users]);
  const cms = useMemo(() => users.filter((u) => u.role === "CM" || u.role === "ADMIN"), [users]);
  const videastes = useMemo(() => users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN"), [users]);

  const hasNoPatterns = !loadingPatterns && patterns.length === 0 && !!accountId;
  const isPatternMode = mode === "pattern" && !hasNoPatterns;

  // ─── Submit ─────────────────────────────────────────────────────────────
  const canSubmit = useCallback(() => {
    if (!accountId) return false;
    if (isPatternMode) return !!selectedPatternId;
    if (!title.trim()) return false;
    if (oneOffCoverMode === "auto" && !oneOffCoverPresetId && coverPresets.length > 0) return false;
    if (oneOffNeedsCaptions === true && !oneOffCaptionPresetId) return false;
    if (oneOffNeedsDescription === "autoGenerate" && !oneOffDescriptionPromptId) return false;
    return true;
  }, [
    accountId,
    isPatternMode,
    selectedPatternId,
    title,
    oneOffCoverMode,
    oneOffCoverPresetId,
    coverPresets.length,
    oneOffNeedsCaptions,
    oneOffCaptionPresetId,
    oneOffNeedsDescription,
    oneOffDescriptionPromptId,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Anti double-submit : l'utilisateur peut soumettre via Entrée pendant
    // qu'un POST est en vol (le bouton "Créer" est disabled mais pas le
    // form). Sans ce guard, 2 slots dupliqués peuvent être créés pour le
    // même {accountId, scheduledAt, patternId}.
    if (saving) return;
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
        if (oneOffCoverPresetId) payload.coverPresetIdOverride = oneOffCoverPresetId;
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
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la création");
      }
      const slot = await res.json() as PublicationSlot;
      onCreated(slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  const selectedPattern = patterns.find((p) => p.id === selectedPatternId);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header avec tabs */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 pt-5 pb-3 z-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Nouveau slot</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setMode("pattern")}
              disabled={hasNoPatterns}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "pattern"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              <Sparkles size={12} />
              Depuis un pattern
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === "manual"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <PenLine size={12} />
              Manuel (one-off)
            </button>
          </div>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-6 space-y-4">
          {/* Compte (commun aux 2 modes) */}
          <FormField label="Compte Instagram" required>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              className={SELECT_CLS}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.handle} — {a.name}</option>
              ))}
            </select>
          </FormField>

          {/* Mode PATTERN */}
          {isPatternMode && (
            <>
              <FormField label="Pattern" required help="Le pattern fixe le template, les sous-titres et la cover par défaut.">
                {loadingPatterns ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                    <div className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
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
                          className={`w-full text-left p-3 rounded-lg border transition-all ${
                            isSelected
                              ? "border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-200"
                              : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-900">{p.label}</span>
                            {p.source && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                                {SOURCE_LABEL[p.source] ?? p.source}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={11} />
                              {p.dayOfWeek.length === 0
                                ? "Pattern manuel (pas de planning auto)"
                                : `${p.dayOfWeek.map((d) => DAYS[d] ?? `J${d}`).join("/")} · ${p.publishTime}`}
                            </span>
                            {(p.defaultAssigneeVideaste || p.defaultAssigneeMonteur || p.defaultAssigneeCm) && (
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
            </>
          )}

          {/* Mode MANUAL — info pas de pattern */}
          {hasNoPatterns && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                Pas de pattern actif sur ce compte. Tu peux créer un slot manuel, ou{" "}
                <Link
                  href={`/admin/accounts/${accountId}`}
                  target="_blank"
                  className="underline hover:text-amber-900"
                >
                  configurer un pattern
                </Link>.
              </span>
            </div>
          )}

          {/* Date + Heure (commun) */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required>
              <Input type="date" value={date} onChange={setDate} required />
            </FormField>
            <FormField label="Heure" required>
              <Input type="time" value={time} onChange={setTime} required />
            </FormField>
          </div>

          {/* Titre — toujours visible, optionnel en mode pattern */}
          <FormField
            label="Titre"
            required={!isPatternMode}
            help={
              isPatternMode
                ? "Optionnel : surcharge le label du pattern pour ce slot."
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

          {/* Assignés (commun, pré-rempli en mode pattern) */}
          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <Users size={12} />
              Équipe assignée
              {isPatternMode && (
                <span className="text-[10px] text-gray-400 font-normal">
                  pré-remplie depuis le pattern · modifiable
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Vidéaste">
                <select
                  value={assigneeVideasteId}
                  onChange={(e) => setAssigneeVideasteId(e.target.value)}
                  className={SELECT_CLS}
                  disabled={loadingMeta}
                >
                  <option value="">— Aucun —</option>
                  {videastes.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Monteur">
                <select
                  value={assigneeMonteurId}
                  onChange={(e) => setAssigneeMonteurId(e.target.value)}
                  className={SELECT_CLS}
                  disabled={loadingMeta}
                >
                  <option value="">— Aucun —</option>
                  {monteurs.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </FormField>
              <div className="col-span-2">
                <FormField label="Community manager">
                  <select
                    value={assigneeCmId}
                    onChange={(e) => setAssigneeCmId(e.target.value)}
                    className={SELECT_CLS}
                    disabled={loadingMeta}
                  >
                    <option value="">— Aucun —</option>
                    {cms.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>
            {!assigneeMonteurId && (
              <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                Sans monteur assigné, ce slot n&apos;apparaîtra dans la worklist d&apos;aucun monteur.
              </div>
            )}
          </div>

          {/* Options de production — uniquement mode MANUEL */}
          {!isPatternMode && (
            <details className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/30 p-3 group" open>
              <summary className="cursor-pointer text-xs font-medium text-fuchsia-900 select-none">
                Options de production
                <span className="ml-1 text-fuchsia-700/70 font-normal text-[10px]">
                  · pré-régler la cover, les captions, la description…
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Cover automatique">
                    <select
                      value={oneOffCoverMode}
                      onChange={(e) => setOneOffCoverMode(e.target.value)}
                      className={SELECT_CLS}
                    >
                      <option value="">— Manuel —</option>
                      <option value="auto">Auto</option>
                      <option value="manualSelect">Sélection CM</option>
                      <option value="none">Désactivée</option>
                    </select>
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

                {oneOffCoverMode === "auto" && (
                  <FormField
                    label="Preset cover"
                    required
                    help={coverPresets.length === 0 ? "Aucun preset disponible — il faut un template lié au pattern." : undefined}
                  >
                    <select
                      value={oneOffCoverPresetId}
                      onChange={(e) => setOneOffCoverPresetId(e.target.value)}
                      disabled={loadingCoverPresets || coverPresets.length === 0}
                      className={SELECT_CLS}
                    >
                      <option value="">— Choisir un preset —</option>
                      {coverPresets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </FormField>
                )}

                {oneOffNeedsCaptions === true && (
                  <FormField label="Preset captions" required>
                    <select
                      value={oneOffCaptionPresetId}
                      onChange={(e) => setOneOffCaptionPresetId(e.target.value)}
                      className={SELECT_CLS}
                    >
                      <option value="">— Choisir un preset —</option>
                      {captionPresets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </FormField>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Mode description">
                    <select
                      value={oneOffNeedsDescription}
                      onChange={(e) => setOneOffNeedsDescription(e.target.value)}
                      className={SELECT_CLS}
                    >
                      <option value="">— Aucune —</option>
                      <option value="none">Aucune</option>
                      <option value="preFilled">Pré-remplie</option>
                      <option value="autoGenerate">Auto-générée</option>
                      <option value="manualWrite">Manuelle</option>
                    </select>
                  </FormField>
                  {oneOffNeedsDescription === "autoGenerate" && (
                    <FormField label="Prompt IA" required>
                      <select
                        value={oneOffDescriptionPromptId}
                        onChange={(e) => setOneOffDescriptionPromptId(e.target.value)}
                        className={SELECT_CLS}
                      >
                        <option value="">— Choisir un prompt —</option>
                        {descriptionPrompts.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </FormField>
                  )}
                </div>
              </div>
            </details>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={onClose}
              className="flex-1"
              disabled={saving}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              icon={Plus}
              loading={saving}
              disabled={!canSubmit() || loadingMeta || loadingPatterns}
              className="flex-1"
            >
              {saving ? "Création…" : "Créer le slot"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── OneOffToggle ────────────────────────────────────────────────────────────

function OneOffToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <FormField label={label}>
      <select
        value={value === null ? "default" : value ? "true" : "false"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "default" ? null : v === "true");
        }}
        className={SELECT_CLS}
      >
        <option value="default">— Défaut (non) —</option>
        <option value="true">Forcer : Oui</option>
        <option value="false">Forcer : Non</option>
      </select>
    </FormField>
  );
}
