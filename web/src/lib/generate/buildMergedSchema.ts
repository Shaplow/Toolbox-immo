/**
 * buildMergedSchema — construit le schéma unifié d'un template en fusionnant :
 *   - json.schema (champs déclarés manuellement)
 *   - DPE_AUTO_FIELDS (si le template contient au moins un bloc DPE)
 *   - champs vidéo/audio auto-injectés (blocks avec binding non déclaré)
 *   - champs conditionnels collectés depuis collectTemplateConditionValues
 *
 * Extrait de web/src/app/(app)/generate/[templateId]/page.tsx (l.97-148)
 * pour être réutilisé par la route POST /api/templates/[id]/prefill.
 *
 * NOTE : le filtrage finalSchema (suppression des champs vidéo orphelins en
 * mode auto) reste dans page.tsx — il est UI-only et n'est pas nécessaire
 * pour le pré-remplissage.
 */

import { collectTemplateConditionValues } from "@/lib/templateNormalization";
import type { TemplateJSON, SchemaField } from "@/types/template";
import { DPE_AUTO_FIELDS } from "@/lib/renderer/blocks/renderDPEBlock";

export function buildMergedSchema(json: TemplateJSON): SchemaField[] {
  // Start from the user-defined schema (source of truth for manual variables)
  const schemaMap = new Map(json.schema.map((f) => [f.key, f]));

  // If the template contains at least one DPE block, inject the 4 fixed DPE fields
  // (only for keys not already declared manually in the schema)
  const hasDpe = json.blocks.some((b) => b.type === "dpe");
  if (hasDpe) {
    for (const field of DPE_AUTO_FIELDS) {
      if (!schemaMap.has(field.key)) schemaMap.set(field.key, field);
    }
  }

  // Auto-inject video fields for video blocks with a binding not already in schema
  for (const block of json.blocks) {
    if (block.type === "video" && block.binding && !schemaMap.has(block.binding)) {
      schemaMap.set(block.binding, {
        key: block.binding,
        label: block.binding.charAt(0).toUpperCase() + block.binding.slice(1).replace(/_/g, " "),
        type: "video",
        required: true,
        description: "Vidéo à intégrer dans le template (MP4 · MOV · WEBM)",
      });
    }
  }

  // Auto-inject audio fields for music blocks with a binding not already in schema
  for (const block of json.blocks) {
    if (block.type === "music" && block.binding && !schemaMap.has(block.binding)) {
      schemaMap.set(block.binding, {
        key: block.binding,
        label: block.binding.charAt(0).toUpperCase() + block.binding.slice(1).replace(/_/g, " "),
        type: "audio",
        required: false,
        description: "Musique de fond (MP3 · WAV · AAC · M4A · OGG)",
      });
    }
  }

  const conditionValues = collectTemplateConditionValues(json);
  for (const [field, values] of conditionValues) {
    if (!schemaMap.has(field)) {
      // Phase 8.M5 : filtrer les valeurs vides ("") du set d'options. Une rule
      // text-field avec equals:"" (= "vide") serait collectée mais ne doit pas
      // devenir une option du select — sinon le user verrait un select avec
      // une seule option blanche. Si toutes les valeurs sont vides → fallback
      // sur un field text au lieu de select.
      const validOptions = [...values].filter((v) => v !== "");
      schemaMap.set(field, {
        key: field,
        label: field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " "),
        type: validOptions.length > 0 ? "select" : "text",
        required: false,
        ...(validOptions.length > 0 ? { options: validOptions } : {}),
        description: "Champ conditionnel — laisser vide pour masquer les blocs conditionnels",
      });
    }
  }

  return [...schemaMap.values()];
}
