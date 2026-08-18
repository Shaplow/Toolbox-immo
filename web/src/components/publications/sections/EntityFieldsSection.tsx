"use client";

/**
 * EntityFieldsSection — résumé LECTURE SEULE des champs de la ou des fiches
 * rattachées au slot (fiche data via `slot.entityId`, fiche tournage via
 * `slot.shootEntityId`).
 *
 * Avant cette section, la fiche publication affichait seulement le LIEN vers
 * la fiche rattachée — pour voir ce qui alimente la génération/la légende,
 * il fallait ouvrir la fiche dans un autre onglet. Pour beaucoup de rôles
 * (types de fiche `visibility="admin"`, ex. « Bien »), cet onglet n'est même
 * pas accessible : cette section EST leur seule vue sur ces valeurs
 * (`canOpen` masque le lien « Ouvrir la fiche » quand ce n'est pas le cas).
 *
 * Aucune édition ici — édition uniquement sur la fiche elle-même
 * (`/fiches/[id]`), quand le rôle y a accès.
 */

import Link from "next/link";
import { FileSpreadsheet, ExternalLink } from "lucide-react";
import { Section } from "@/components/ui/molecules/Section";
import type { EntityFieldsSummary } from "@/lib/publications/entityFieldsSummary";

interface EntityFieldsSectionProps {
  summaries: EntityFieldsSummary[];
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

const ROLE_LABEL: Record<EntityFieldsSummary["role"], string> = {
  data: "Fiche",
  shoot: "Fiche tournage",
};

export function EntityFieldsSection({
  summaries,
  sectionId = "entityFields",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: EntityFieldsSectionProps) {
  if (summaries.length === 0) return null;

  return (
    <Section
      title="Champs de la fiche"
      icon={FileSpreadsheet}
      description="Valeurs qui alimentent la génération et la légende."
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
    >
      <div className="space-y-4">
        {summaries.map((summary) => (
          <div
            key={summary.entityId}
            className="rounded-lg border border-border bg-muted/40 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {ROLE_LABEL[summary.role]} · {summary.typeName} — {summary.label}
              </p>
              {summary.canOpen && (
                <Link
                  href={`/fiches/${summary.entityId}`}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  Ouvrir la fiche
                  <ExternalLink size={11} />
                </Link>
              )}
            </div>
            {summary.fields.length > 0 ? (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                {summary.fields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-muted-foreground truncate">{f.label}</dt>
                    <dd className="text-foreground truncate">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Cette fiche n&apos;a pas encore de valeurs.
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
