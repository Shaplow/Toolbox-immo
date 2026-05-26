import { getConditionSourceFields, getConditionValueOptions } from "@/lib/schemaFields";
import type { BlockConditionalRule, LayerGroup, SchemaField } from "@/types/template";
import { Section } from "./Section";

export function GroupConditionalRulesSection({
  group,
  schema,
  onChange,
}: {
  group: LayerGroup;
  schema: SchemaField[];
  onChange: (c: Partial<LayerGroup>) => void;
}) {
  const conditionalRules = group.conditionalRules ?? [];
  const conditionFields = getConditionSourceFields(schema);

  function updateRule(index: number, changes: Partial<BlockConditionalRule>) {
    const next = conditionalRules.map((rule, ruleIndex) => {
      if (ruleIndex !== index) return rule;
      return {
        ...rule,
        ...changes,
        when: { ...rule.when, ...(changes.when ?? {}) },
        effects: {
          ...rule.effects,
          ...(changes.effects ?? {}),
        },
      };
    });
    onChange({ conditionalRules: next });
  }

  function removeRule(index: number) {
    onChange({ conditionalRules: conditionalRules.filter((_, ruleIndex) => ruleIndex !== index) });
  }

  function addRule() {
    const firstField = conditionFields[0];
    const defaultEquals = getConditionValueOptions(firstField)[0]?.value ?? "";
    onChange({
      conditionalRules: [
        ...conditionalRules,
        {
          when: { field: firstField?.key ?? "", equals: defaultEquals },
          effects: {},
        },
      ],
    });
  }

  return (
    <Section label="Règles conditionnelles">
      <div className="space-y-3">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Les règles de groupe permettent de masquer tout un ensemble de calques ou de le décaler d&apos;un coup selon une valeur du formulaire.
        </p>
        {conditionFields.length === 0 && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
            Ajoute d&apos;abord un champ de type liste ou oui/non dans le schéma pour créer une variante conditionnelle.
          </p>
        )}
        {conditionalRules.map((rule, index) => {
          const selectedField = schema.find((item) => item.key === rule.when.field);
          const valueOptions = getConditionValueOptions(selectedField);
          return (
            <div key={`${rule.when.field}-${index}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-gray-600">Règle {index + 1}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Quand {selectedField?.label || rule.when.field || "un champ"} vaut {rule.when.equals || "…"}</p>
                </div>
                <button type="button" onClick={() => removeRule(index)} className="text-[11px] text-red-500 hover:text-red-600">
                  Supprimer
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Champ</span>
                  <select
                    value={rule.when.field}
                    onChange={(e) => {
                      const nextField = schema.find((item) => item.key === e.target.value);
                      updateRule(index, {
                        when: {
                          field: e.target.value,
                          equals: getConditionValueOptions(nextField)[0]?.value ?? "",
                        },
                      });
                    }}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="">— choisir —</option>
                    {conditionFields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label || field.key}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Valeur attendue</span>
                  {valueOptions.length > 0 ? (
                    <select
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    >
                      <option value="">— choisir —</option>
                      {valueOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      placeholder="valeur"
                      className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                    />
                  )}
                </label>
                <label className="flex flex-col gap-0.5 col-span-2">
                  <span className="text-gray-400 text-[11px]">Effet de visibilité</span>
                  <select
                    value={rule.effects.visible === true ? "show" : rule.effects.visible === false ? "hide" : "none"}
                    onChange={(e) => updateRule(index, {
                      effects: {
                        ...rule.effects,
                        visible: e.target.value === "show" ? true : e.target.value === "hide" ? false : undefined,
                      },
                    })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="none">Aucun</option>
                    <option value="show">Afficher le groupe</option>
                    <option value="hide">Masquer le groupe</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage X</span>
                  <input
                    type="number"
                    value={rule.effects.offsetX ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetX: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-gray-400 text-[11px]">Décalage Y</span>
                  <input
                    type="number"
                    value={rule.effects.offsetY ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetY: Number(e.target.value) } })}
                    className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
                  />
                </label>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addRule}
          disabled={conditionFields.length === 0}
          className="w-full text-center text-xs py-2 border border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
        >
          + Ajouter une règle
        </button>
      </div>
    </Section>
  );
}
