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
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
            Ajoute d&apos;abord un champ de type liste ou oui/non dans le schéma pour créer une variante conditionnelle.
          </p>
        )}

        {conditionalRules.map((rule, index) => {
          const selectedField = schema.find((item) => item.key === rule.when.field);
          const valueOptions = getConditionValueOptions(selectedField);
          return (
            <div key={`${rule.when.field}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
              {/* Rule header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-gray-700">Règle {index + 1}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Quand <span className="font-medium">{selectedField?.label || rule.when.field || "un champ"}</span> vaut <span className="font-medium">{rule.when.equals || "…"}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="text-[11px] text-red-400 hover:text-red-600 shrink-0 px-1.5 py-0.5 rounded border border-transparent hover:border-red-200 hover:bg-red-50 transition-colors"
                >
                  Supprimer
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-medium text-gray-600">Champ</span>
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
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="">— choisir —</option>
                    {conditionFields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label || field.key}</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-medium text-gray-600">Valeur attendue</span>
                  {valueOptions.length > 0 ? (
                    <select
                      value={rule.when.equals}
                      onChange={(e) => updateRule(index, { when: { ...rule.when, equals: e.target.value } })}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
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
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                    />
                  )}
                </label>

                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-medium text-gray-600">Effet de visibilité</span>
                  <select
                    value={rule.effects.visible === true ? "show" : rule.effects.visible === false ? "hide" : "none"}
                    onChange={(e) => updateRule(index, {
                      effects: {
                        ...rule.effects,
                        visible: e.target.value === "show" ? true : e.target.value === "hide" ? false : undefined,
                      },
                    })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-500"
                  >
                    <option value="none">Aucun</option>
                    <option value="show">Afficher le groupe</option>
                    <option value="hide">Masquer le groupe</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">Décalage X</span>
                  <input
                    type="number"
                    value={rule.effects.offsetX ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetX: Number(e.target.value) } })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">Décalage Y</span>
                  <input
                    type="number"
                    value={rule.effects.offsetY ?? 0}
                    onChange={(e) => updateRule(index, { effects: { ...rule.effects, offsetY: Number(e.target.value) } })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
          className="w-full text-center text-xs py-2 border border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-600 disabled:hover:bg-transparent transition-colors"
        >
          + Ajouter une règle
        </button>
      </div>
    </Section>
  );
}
