"use client";

/**
 * Formulaire du tiroir « Nouveau lien de téléchargement » : ce qu'on donne au
 * client (contenu, comptes, bibliothèques) et pour combien de temps.
 *
 * Rend le corps ET le pied du tiroir (ils partagent l'état). Tous les calculs
 * passent par `clientExportModel` : ici, que de l'affichage.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { AccountLabel } from "@/components/ui/AccountLabel";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  DEFAULT_EXPORT_LINK_DURATION_DAYS,
  type CreateExportLinkRequest,
  type ExportLinkDurationDays,
  type ExportPreview,
} from "@/lib/clientExport/types";
import {
  DURATION_OPTIONS,
  buildCreateRequest,
  computeExportModel,
  defaultSelection,
  describeMissingFiles,
  describeUnavailablePublications,
  formatCommon,
  formatCount,
  formatVolume,
  isEmptyVolume,
  parseDuration,
  setAccounts,
  setContent,
  setLibraries,
  unavailableNeedsAction,
  type AccountLine,
  type ContentRow,
  type ExportBlocker,
  type LibraryGroup,
  type LibraryLine,
} from "./clientExportModel";

interface ExportSelectionFormProps {
  preview: ExportPreview;
  creating: boolean;
  onCreate: (request: CreateExportLinkRequest) => void;
}

const BLOCKER_MESSAGES: Record<ExportBlocker, string> = {
  no_account: "Coche au moins un compte Instagram.",
  nothing_available: "Rien à exporter pour cette sélection.",
  no_content: "Coche au moins un contenu à exporter.",
};

/** Le handle est stocké avec ou sans « @ » selon la saisie : on n'en affiche qu'un. */
function bareHandle(handle: string): string {
  return handle.replace(/^@+/, "");
}

export function ExportSelectionForm({ preview, creating, onCreate }: ExportSelectionFormProps) {
  const [selection, setSelection] = useState(() => defaultSelection(preview));
  const [duration, setDuration] = useState<ExportLinkDurationDays>(DEFAULT_EXPORT_LINK_DURATION_DAYS);
  const [label, setLabel] = useState("");

  const model = useMemo(() => computeExportModel(preview, selection), [preview, selection]);
  const request = buildCreateRequest(model, duration, label);

  const allAccountIds = preview.accounts.map((account) => account.id);
  const allChecked = model.accounts.every((account) => account.checked);
  const noneChecked = model.accounts.every((account) => !account.checked);

  return (
    <>
      <Drawer.Body className="space-y-6">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Le client télécharge ses fichiers sur son ordinateur, rangés par compte Instagram. Coche
          ce que tu veux lui donner.
        </p>

        <FormSection title="Contenu">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {model.rows.map((row) => (
              <ContentRowItem
                key={row.key}
                row={row}
                onChange={(on) => setSelection((s) => setContent(s, row.key, on))}
              />
            ))}
          </ul>
          {preview.missingFiles > 0 && (
            <Alert variant="warning">{describeMissingFiles(preview.missingFiles)}</Alert>
          )}
        </FormSection>

        <FormSection
          title="Comptes Instagram"
          actions={
            <span className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={allChecked}
                onClick={() => setSelection((s) => setAccounts(s, allAccountIds, true))}
              >
                Tout cocher
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={noneChecked}
                onClick={() => setSelection((s) => setAccounts(s, allAccountIds, false))}
              >
                Tout décocher
              </Button>
            </span>
          }
        >
          <ul className="divide-y divide-border rounded-lg border border-border">
            {model.accounts.map((account) => (
              <AccountRowItem
                key={account.id}
                account={account}
                onChange={(on) => setSelection((s) => setAccounts(s, [account.id], on))}
              />
            ))}
          </ul>
        </FormSection>

        {model.groups.length > 0 && (
          <FormSection title="Bibliothèques">
            <div className="space-y-3">
              {model.groups.map((group) => (
                <LibraryGroupBlock
                  key={group.type}
                  group={group}
                  onToggleGroup={(on) =>
                    setSelection((s) =>
                      setLibraries(
                        s,
                        group.libraries.map((line) => line.id),
                        on,
                      ),
                    )
                  }
                  onToggleLibrary={(id, on) => setSelection((s) => setLibraries(s, [id], on))}
                />
              ))}
            </div>
          </FormSection>
        )}

        <FormSection title="Validité">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Durée">
              <Select
                value={String(duration)}
                onChange={(value) => setDuration(parseDuration(value))}
                options={DURATION_OPTIONS}
              />
            </FormField>
            <FormField label="Libellé (optionnel)">
              <Input
                value={label}
                onChange={setLabel}
                placeholder="Ex. Fin de contrat"
                maxLength={120}
              />
            </FormField>
          </div>
        </FormSection>
      </Drawer.Body>

      <Drawer.Footer>
        <p className="min-w-0 flex-1 text-[13px] text-foreground">
          {model.blocker ? (
            <span className="text-muted-foreground">{BLOCKER_MESSAGES[model.blocker]}</span>
          ) : (
            <>
              <span className="text-muted-foreground">Total : </span>
              <span className="font-medium tabular-nums">{formatVolume(model.total)}</span>
            </>
          )}
        </p>
        <Button
          loading={creating}
          disabled={request === null}
          onClick={() => {
            if (request) onCreate(request);
          }}
        >
          Créer le lien
        </Button>
      </Drawer.Footer>
    </>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function FormSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Toute la ligne coche : le libellé et son volume étaient du texte mort à côté d'une case de 16 px. */
function rowClass(disabled: boolean, align: "start" | "center" = "start"): string {
  return [
    "flex select-none gap-3 px-3 py-2.5",
    align === "center" ? "items-center" : "items-start",
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50",
  ].join(" ");
}

function ContentRowItem({ row, onChange }: { row: ContentRow; onChange: (on: boolean) => void }) {
  const disabled = !row.available;
  const unavailableText = describeUnavailablePublications(row.unavailable);
  return (
    <li>
      <label className={rowClass(disabled)}>
        <Checkbox
          checked={row.checked}
          onChange={onChange}
          disabled={disabled}
          size="sm"
          label={row.label}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-foreground">{row.label}</span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">{row.hint}</span>
          {unavailableText && (
            // Warning seulement s'il y a quelque chose à corriger : des posts image
            // seuls sont normaux, pas une alerte.
            <span
              className={[
                "block text-[11.5px] leading-snug",
                unavailableNeedsAction(row.unavailable)
                  ? "text-warning-700"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              {unavailableText}
            </span>
          )}
        </span>
        <span
          className={[
            "shrink-0 pt-px text-right text-[12px] tabular-nums",
            row.checked ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {disabled ? "Rien à exporter" : formatVolume(row.volume)}
        </span>
      </label>
    </li>
  );
}

function AccountRowItem({
  account,
  onChange,
}: {
  account: AccountLine;
  onChange: (on: boolean) => void;
}) {
  return (
    <li>
      <label className={rowClass(false, "center")}>
        <Checkbox checked={account.checked} onChange={onChange} size="sm" label={account.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{account.name}</span>
          {/* Le gabarit de ligne vient du parent : à 13 px, l'inline-flex d'AccountLabel
              écartait le handle du nom. */}
          <span className="block text-[11.5px] leading-snug text-muted-foreground">
            <AccountLabel handle={bareHandle(account.handle)} />
          </span>
        </span>
        <span
          className={[
            "shrink-0 text-right text-[12px] tabular-nums",
            account.checked && !isEmptyVolume(account.volume)
              ? "text-foreground"
              : "text-muted-foreground",
          ].join(" ")}
        >
          {formatVolume(account.volume)}
        </span>
      </label>
    </li>
  );
}

function LibraryGroupBlock({
  group,
  onToggleGroup,
  onToggleLibrary,
}: {
  group: LibraryGroup;
  onToggleGroup: (on: boolean) => void;
  onToggleLibrary: (id: string, on: boolean) => void;
}) {
  const checkedCount = group.libraries.filter((line) => line.checked).length;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <label className="flex cursor-pointer select-none items-center gap-3 border-b border-border bg-muted/40 px-3 py-2">
        <Checkbox
          checked={group.state}
          onChange={onToggleGroup}
          size="sm"
          label={`Toutes les bibliothèques : ${group.label}`}
        />
        <span className="flex-1 text-[12px] font-medium text-foreground">{group.label}</span>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {formatCount(checkedCount)} / {formatCount(group.libraries.length)}
        </span>
      </label>
      <ul className="divide-y divide-border">
        {group.libraries.map((line) => (
          <LibraryRowItem
            key={line.id}
            line={line}
            onChange={(on) => onToggleLibrary(line.id, on)}
          />
        ))}
      </ul>
    </div>
  );
}

function LibraryRowItem({ line, onChange }: { line: LibraryLine; onChange: (on: boolean) => void }) {
  const common = formatCommon(line);
  return (
    <li>
      <label className="flex cursor-pointer select-none items-start gap-3 py-2 pl-8 pr-3 hover:bg-muted/50">
        <Checkbox
          checked={line.checked}
          onChange={onChange}
          size="sm"
          label={line.name}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-foreground" title={line.name}>
            {line.name}
          </span>
          {common && (
            <span className="block text-[11.5px] leading-snug text-muted-foreground">{common}</span>
          )}
        </span>
        <span
          className={[
            "shrink-0 pt-px text-right text-[12px] tabular-nums",
            line.checked ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {formatVolume(line.volume)}
        </span>
      </label>
    </li>
  );
}
