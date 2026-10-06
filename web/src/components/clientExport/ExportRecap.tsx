"use client";

/**
 * Récapitulatif du lien avant le lancement : volume à télécharger, détail par
 * compte, et fichiers qui ne pourront pas l'être.
 *
 * Les deux détails sont repliés : le volume total et le bouton de lancement
 * doivent tenir dans le premier écran, le reste se déplie à la demande.
 */

import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatMaxSize } from "@/lib/upload/limits";
import type { ExportManifest, ExportSkipped } from "@/lib/clientExport/types";
import { groupByAccount, plural, skipReasonLabel, type AccountGroup } from "./exportModel";

const ACCOUNT_DETAIL_TITLE = "Détail par compte";

// Le titre du contenu déplié est écrit dans la carte : la section repliée ne montre que le sien,
// et le chevron de repli de CollapsibleSection se pose en haut à droite de la carte (d'où `pr-8`).

export function AccountDetailCard({ groups }: { groups: AccountGroup[] }) {
  return (
    <Card>
      <h2 className="pr-8 text-[13px] font-semibold text-foreground">{ACCOUNT_DETAIL_TITLE}</h2>
      <ul className="mt-2 divide-y divide-border">
        {groups.map((group) => (
          <li key={group.name} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
            <span className="min-w-0 break-words font-medium text-foreground">
              {group.name}
              {group.common && (
                <span className="ml-1.5 font-normal text-muted-foreground">partagé entre tous les comptes</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {plural(group.files, "fichier", "fichiers")}
              {group.bytes > 0 ? ` · ${formatMaxSize(group.bytes)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function skippedTitle(count: number): string {
  return plural(count, "fichier indisponible", "fichiers indisponibles");
}

export function SkippedDetailCard({ skipped }: { skipped: ExportSkipped[] }) {
  return (
    <Card>
      <h2 className="pr-8 text-[13px] font-semibold text-foreground">{skippedTitle(skipped.length)}</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">Ils ne seront pas téléchargés avec ce lien.</p>
      <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto">
        {skipped.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
            <span className="min-w-0 break-words text-foreground">{item.label}</span>
            <span className="shrink-0 text-muted-foreground">{skipReasonLabel(item.reason)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ExportRecap({ manifest }: { manifest: ExportManifest }) {
  const { files, bytes } = manifest.totals;

  if (files === 0) {
    return (
      <Alert variant="warning" title="Aucun fichier n'est disponible avec ce lien.">
        Demande à ton interlocuteur de le vérifier.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-lg font-semibold tabular-nums text-foreground">
          {plural(files, "fichier", "fichiers")}
          {bytes > 0 ? ` · ${formatMaxSize(bytes)}` : ""} à télécharger
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Tout sera rangé dans un dossier « {manifest.rootName} », avec un sous-dossier par compte.
        </p>
      </Card>

      <CollapsibleSection title={ACCOUNT_DETAIL_TITLE} defaultOpen={false}>
        <AccountDetailCard groups={groupByAccount(manifest.files)} />
      </CollapsibleSection>
    </div>
  );
}

/** Éléments attendus mais que le serveur ne peut pas fournir (introuvables, publications image…). */
export function ExportSkippedList({ skipped }: { skipped: ExportSkipped[] }) {
  if (skipped.length === 0) return null;
  return (
    <CollapsibleSection title={skippedTitle(skipped.length)} defaultOpen={false}>
      <SkippedDetailCard skipped={skipped} />
    </CollapsibleSection>
  );
}
