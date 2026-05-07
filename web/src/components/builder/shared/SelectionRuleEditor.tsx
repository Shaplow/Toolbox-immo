"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import type { MediaSelectionRule, MediaSelectionRuleConfig, TagCondition } from "@/types/template";

// ─── Utilities ────────────────────────────────────────────────────────────────

export function normalizeSelectionRule(rule: MediaSelectionRule | undefined): MediaSelectionRuleConfig {
  if (!rule) return { strategy: "least_used" };
  if (typeof rule === "string") return { strategy: rule as MediaSelectionRuleConfig["strategy"] };
  return rule as MediaSelectionRuleConfig;
}

function buildRule(
  strategy: string,
  tagConditions: TagCondition[],
  tagConditionsOperator: "AND" | "OR",
  igAccountFilter: string,
  igAccountFilterParam: string,
  igMode: "literal" | "param",
): MediaSelectionRule {
  if (strategy === "manual") return "manual";
  const s = strategy as MediaSelectionRuleConfig["strategy"];
  const cleanConditions = tagConditions.filter((c) => c.tag.trim() !== "");
  const hasIg =
    igMode === "literal" ? igAccountFilter.trim() !== "" : igAccountFilterParam !== "";
  if (cleanConditions.length === 0 && !hasIg) return s;
  const result: MediaSelectionRuleConfig = { strategy: s };
  if (cleanConditions.length > 0) {
    result.tagConditions = cleanConditions;
    if (cleanConditions.length > 1) result.tagConditionsOperator = tagConditionsOperator;
  }
  if (hasIg) {
    if (igMode === "literal") result.igAccountFilter = igAccountFilter.trim();
    else result.igAccountFilterParam = igAccountFilterParam;
  }
  return result;
}

function initConditions(config: MediaSelectionRuleConfig): TagCondition[] {
  if (config.tagConditions?.length) return config.tagConditions;
  // Migrate legacy fields
  if (config.tagFilter) return [{ tag: config.tagFilter }];
  if (config.tagFilterParam) return [{ tag: config.tagFilterParam, fromParam: true }];
  return [];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SelectionRuleEditor({
  rule,
  onChange,
  strategies,
  schema,
}: {
  rule: MediaSelectionRule | undefined;
  onChange: (r: MediaSelectionRule) => void;
  strategies: { value: string; label: string }[];
  schema?: { key: string; label?: string; type: string }[];
}) {
  const config = normalizeSelectionRule(rule);
  const paramFields = schema?.filter((f) => ["select", "text"].includes(f.type)) ?? [];

  const [strategy, setStrategy] = useState(config.strategy);
  const [tagConditions, setTagConditions] = useState<TagCondition[]>(() => initConditions(config));
  const [tagConditionsOperator, setTagConditionsOperator] = useState<"AND" | "OR">(
    config.tagConditionsOperator ?? "AND",
  );
  const [igAccountFilter, setIgAccountFilter] = useState(config.igAccountFilter ?? "");
  const [igAccountFilterParam, setIgAccountFilterParam] = useState(
    config.igAccountFilterParam ?? "",
  );
  const [igMode, setIgMode] = useState<"literal" | "param">(
    config.igAccountFilterParam ? "param" : "literal",
  );

  function emit(
    s: string = strategy,
    conditions: TagCondition[] = tagConditions,
    condOp: "AND" | "OR" = tagConditionsOperator,
    igLit: string = igAccountFilter,
    igParam: string = igAccountFilterParam,
    igM: "literal" | "param" = igMode,
  ) {
    onChange(buildRule(s, conditions, condOp, igLit, igParam, igM));
  }

  function handleStrategyChange(s: string) {
    setStrategy(s);
    emit(s);
  }

  function addCondition() {
    const next = [...tagConditions, { tag: "" }];
    setTagConditions(next);
    emit(strategy, next);
  }

  function removeCondition(idx: number) {
    const next = tagConditions.filter((_, i) => i !== idx);
    setTagConditions(next);
    emit(strategy, next);
  }

  function updateCondition(idx: number, patch: Partial<TagCondition>) {
    const next = tagConditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setTagConditions(next);
    emit(strategy, next);
  }

  function handleOperatorChange(op: "AND" | "OR") {
    setTagConditionsOperator(op);
    emit(strategy, tagConditions, op);
  }

  function handleIgModeChange(m: "literal" | "param") {
    setIgMode(m);
    if (m === "literal") {
      setIgAccountFilterParam("");
      emit(strategy, tagConditions, tagConditionsOperator, igAccountFilter, "", m);
    } else {
      // Auto-select first available param field so the dropdown is never left blank
      const defaultParam = igAccountFilterParam || paramFields[0]?.key || "";
      setIgAccountFilter("");
      setIgAccountFilterParam(defaultParam);
      emit(strategy, tagConditions, tagConditionsOperator, "", defaultParam, m);
    }
  }

  function handleIgLiteralChange(v: string) {
    setIgAccountFilter(v);
    emit(strategy, tagConditions, tagConditionsOperator, v, "", "literal");
  }

  function handleIgParamChange(v: string) {
    setIgAccountFilterParam(v);
    emit(strategy, tagConditions, tagConditionsOperator, "", v, "param");
  }

  const isManual = strategy === "manual";

  return (
    <div className="flex flex-col gap-2">
      {/* Strategy */}
      <select
        value={strategy}
        onChange={(e) => handleStrategyChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
      >
        {strategies.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {!isManual && (
        <>
          {/* ── Tag conditions ──────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                Filtres par tags
              </span>
              {tagConditions.length > 1 && (
                <div className="flex rounded border border-gray-200 overflow-hidden">
                  {(["AND", "OR"] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => handleOperatorChange(op)}
                      className={`px-2 py-0.5 text-[9px] font-medium transition-colors ${
                        tagConditionsOperator === op
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tagConditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-1">
                {/* Tag value: literal text or schema field */}
                {cond.fromParam && paramFields.length > 0 ? (
                  <select
                    value={cond.tag}
                    onChange={(e) => updateCondition(idx, { tag: e.target.value })}
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  >
                    <option value="">— Champ —</option>
                    {paramFields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label || f.key}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={cond.tag}
                    onChange={(e) => updateCondition(idx, { tag: e.target.value })}
                    placeholder="tag…"
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                )}

                {/* Negation toggle */}
                <button
                  type="button"
                  title={cond.negate ? "Condition : doit avoir ce tag" : "Condition : NE doit PAS avoir ce tag"}
                  onClick={() => updateCondition(idx, { negate: !cond.negate })}
                  className={`shrink-0 text-[9px] font-medium px-1.5 py-1 rounded border transition-colors ${
                    cond.negate
                      ? "bg-red-50 border-red-300 text-red-600"
                      : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {cond.negate ? "NON" : "OUI"}
                </button>

                {/* fromParam toggle (only when schema fields available) */}
                {paramFields.length > 0 && (
                  <button
                    type="button"
                    title={cond.fromParam ? "Valeur fixe (littéral)" : "Depuis un champ du formulaire"}
                    onClick={() => updateCondition(idx, { fromParam: !cond.fromParam, tag: "" })}
                    className={`shrink-0 text-[9px] px-1.5 py-1 rounded border transition-colors ${
                      cond.fromParam
                        ? "bg-indigo-50 border-indigo-300 text-indigo-600"
                        : "bg-white border-gray-200 text-gray-400 hover:border-gray-300"
                    }`}
                  >
                    {cond.fromParam ? "≡" : "T"}
                  </button>
                )}

                {/* Remove condition */}
                <button
                  type="button"
                  onClick={() => removeCondition(idx)}
                  className="shrink-0 text-gray-300 hover:text-red-400 transition-colors p-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addCondition}
              className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700 transition-colors self-start"
            >
              <Plus size={11} />
              Ajouter un filtre
            </button>
          </div>

          {/* ── IG account filter ────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Compte IG
            </span>
            {paramFields.length > 0 && (
              <div className="flex rounded border border-gray-200 overflow-hidden">
                {(["literal", "param"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleIgModeChange(m)}
                    className={`flex-1 text-[9px] px-2 py-1 transition-colors ${
                      igMode === m
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {m === "literal" ? "Fixe" : "Depuis un champ"}
                  </button>
                ))}
              </div>
            )}
            {igMode === "literal" || paramFields.length === 0 ? (
              <input
                type="text"
                value={igAccountFilter}
                onChange={(e) => handleIgLiteralChange(e.target.value)}
                placeholder="@handle ou identifiant (optionnel)"
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              />
            ) : (
              <select
                value={igAccountFilterParam}
                onChange={(e) => handleIgParamChange(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {paramFields.map((f) => (
                  <option key={f.key} value={f.key}>{f.label || f.key}</option>
                ))}
              </select>
            )}
          </div>
        </>
      )}
    </div>
  );
}
