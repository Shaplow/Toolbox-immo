"use client";

/**
 * LibraryIdentitySection — onglet « Identité » commun aux drawers de
 * réglages MediaLibrary / DataLibrary (nom + description [+ tags optionnel,
 * MediaLibrary uniquement]).
 *
 * Extrait de MediaLibrarySettingsDrawer / DataLibrarySettingsDrawer où ce
 * bloc était dupliqué à l'identique. L'état (valeurs + dirty-tracking) reste
 * dans chaque drawer — ce composant est purement présentation.
 */

import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { SettingsSectionCard } from "./SettingsSectionCard";

interface TagsField {
  value: string;
  onChange: (value: string) => void;
}

interface LibraryIdentitySectionProps {
  name: string;
  onNameChange: (value: string) => void;
  namePlaceholder?: string;
  description: string;
  onDescriptionChange: (value: string) => void;
  descriptionRows?: number;
  /** Champ Tags — optionnel, MediaLibrary uniquement (DataLibrary n'a pas de tags). */
  tags?: TagsField;
}

export function LibraryIdentitySection({
  name,
  onNameChange,
  namePlaceholder = "Nom de la bibliothèque",
  description,
  onDescriptionChange,
  descriptionRows = 3,
  tags,
}: LibraryIdentitySectionProps) {
  return (
    <SettingsSectionCard title="Identité">
      <FormField label="Nom" required>
        <Input value={name} onChange={onNameChange} placeholder={namePlaceholder} />
      </FormField>
      <FormField label="Description (optionnel)">
        <Textarea
          value={description}
          onChange={onDescriptionChange}
          rows={descriptionRows}
          placeholder="À quoi sert cette bibliothèque…"
        />
      </FormField>
      {tags && (
        <FormField label="Tags" help="Séparés par virgule. Sert au filtrage côté builder / generation.">
          <Input value={tags.value} onChange={tags.onChange} placeholder="RPI, RTIPS" />
        </FormField>
      )}
    </SettingsSectionCard>
  );
}
