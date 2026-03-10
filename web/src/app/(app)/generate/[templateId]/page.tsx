import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ListingForm } from "@/components/form/ListingForm";
import type { TemplateJSON, SchemaField, TextBlock } from "@/types/template";
import { DPE_FIXED_KEYS } from "@/lib/renderer/blocks/renderDPEBlock";

type Props = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ listingId?: string }>;
};

const DPE_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

/** Champs DPE fixes injectés automatiquement si un bloc DPE est présent */
const DPE_AUTO_FIELDS: SchemaField[] = [
  { key: DPE_FIXED_KEYS.energyNote,   label: "Classe énergie (DPE)",         type: "select", required: true,  options: DPE_LETTERS, description: "Note de performance énergétique" },
  { key: DPE_FIXED_KEYS.energyValue,  label: "Consommation (kWh/m²/an)",      type: "number", required: true,  placeholder: "180",   description: "Consommation d'énergie primaire" },
  { key: DPE_FIXED_KEYS.climateNote,  label: "Classe GES (émissions CO₂)",    type: "select", required: true,  options: DPE_LETTERS, description: "Note d'émissions de gaz à effet de serre" },
  { key: DPE_FIXED_KEYS.climateValue, label: "Émissions CO₂ (kg CO₂/m²/an)", type: "number", required: false, placeholder: "12",    description: "Émissions de CO₂ du logement" },
];

export default async function GeneratePage({ params, searchParams }: Props) {
  const { templateId } = await params;
  const { listingId } = await searchParams;
  const session = await auth();
  const userId = session!.user!.id!;

  // If listingId provided, pre-fill form with its data
  let initialValues: Record<string, unknown> | undefined;
  if (listingId) {
    const existingListing = await prisma.listing.findFirst({
      where: { id: listingId, userId },
    });
    if (existingListing) {
      initialValues = JSON.parse(existingListing.jsonData) as Record<string, unknown>;
    }
  }

  const { canAccessTemplate } = await import("@/lib/permissions");
  const ok = await canAccessTemplate(userId, templateId, session!.user!.role ?? undefined);
  if (!ok) notFound();

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) notFound();

  const json = JSON.parse(template.jsonData) as TemplateJSON;

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

  // Auto-inject select fields for showIf conditions (block-level) and {{#if}} in text content
  const showIfMap = new Map<string, Set<string>>();
  for (const block of json.blocks) {
    if (block.showIf) {
      const { field, equals } = block.showIf;
      if (!showIfMap.has(field)) showIfMap.set(field, new Set());
      showIfMap.get(field)!.add(equals);
    }
    if (block.type === "text") {
      const content = (block as TextBlock).content ?? "";
      const matches = [...content.matchAll(/\{\{#if\s+(\w+)\s*==\s*"?([^"\}\s]+)"?\s*\}\}/g)];
      for (const [, field, value] of matches) {
        if (!showIfMap.has(field)) showIfMap.set(field, new Set());
        showIfMap.get(field)!.add(value);
      }
    }
  }
  for (const [field, values] of showIfMap) {
    if (!schemaMap.has(field)) {
      schemaMap.set(field, {
        key: field,
        label: field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " "),
        type: "select",
        required: false,
        options: [...Array.from(values)],
        description: "Champ conditionnel — laisser vide pour masquer les blocs conditionnels",
      });
    }
  }

  const mergedSchema = [...schemaMap.values()];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          {initialValues ? "Nouvelle variante" : "Générer un visuel"}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Template : <span className="text-indigo-700 font-medium">{template.name}</span>
          {template.client && ` · ${template.client}`}
          {initialValues && " · formulaire pré-rempli"}
        </p>
      </div>
      <ListingForm templateId={templateId} schema={mergedSchema} initialValues={initialValues} />
    </div>
  );
}
