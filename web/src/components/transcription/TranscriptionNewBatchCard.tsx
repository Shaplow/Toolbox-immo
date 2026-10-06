"use client";

import { Languages } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Switch } from "@/components/ui/Switch";
import { TRANSCRIPTION_ACCEPT } from "./useTranscriptionUploads";

/** Catalogue Whisper. Une langue = mono ; plusieurs = mode multi (bêta). */
export const LANGUAGE_CHOICES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "es", label: "Espagnol" },
  { value: "de", label: "Allemand" },
  { value: "it", label: "Italien" },
  { value: "pt", label: "Portugais" },
  { value: "zh", label: "Chinois" },
  { value: "ru", label: "Russe" },
  { value: "ja", label: "Japonais" },
  { value: "ko", label: "Coréen" },
  { value: "ar", label: "Arabe" },
] as const;

/**
 * Réglages appliqués aux prochaines vidéos déposées + zone de dépôt. Chaque
 * dépôt (glisser-déposer ou sélection) crée un lot.
 */
export function TranscriptionNewBatchCard({
  languages,
  onLanguagesChange,
  diarization,
  onDiarizationChange,
  diarizationAvailable,
  multiple = true,
  onFiles,
}: {
  languages: string[];
  onLanguagesChange: (languages: string[]) => void;
  diarization: boolean;
  onDiarizationChange: (value: boolean) => void;
  diarizationAvailable: boolean;
  /** Plusieurs fichiers par dépôt (un lot). Faux depuis une publication. */
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const isMultilingual = languages.length >= 2;

  function toggleLanguage(code: string) {
    if (languages.includes(code)) {
      // Au moins une langue : la dernière ne se décoche pas.
      if (languages.length > 1) onLanguagesChange(languages.filter((c) => c !== code));
      return;
    }
    onLanguagesChange([...languages, code]);
  }

  return (
    <Card className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Languages size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Langues</span>
          {isMultilingual && (
            <span className="text-[11px] font-medium text-muted-foreground">
              Multi-langue (bêta) : une passe par langue + traduction inverse, durée × {languages.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_CHOICES.map((choice) => (
            <Chip
              key={choice.value}
              size="sm"
              selected={languages.includes(choice.value)}
              onClick={() => toggleLanguage(choice.value)}
            >
              {choice.label}
            </Chip>
          ))}
        </div>
      </div>

      <Switch
        checked={diarizationAvailable && diarization}
        onChange={onDiarizationChange}
        disabled={!diarizationAvailable}
        label="Identifier les intervenants"
        description={
          diarizationAvailable
            ? "Préfixe chaque sous-titre par son intervenant ([SPEAKER_00]…). Réglable ensuite pour tout le lot ou vidéo par vidéo."
            : "Indisponible sur ce serveur (HF_TOKEN non configuré)."
        }
      />

      <FileDropzone
        accept={TRANSCRIPTION_ACCEPT}
        multiple={multiple}
        onFiles={onFiles}
        ariaLabel="Déposer des vidéos à transcrire"
        title={
          multiple
            ? "Déposez vos vidéos ou fichiers audio, autant que vous voulez"
            : "Déposez la vidéo ou le fichier audio de la publication"
        }
        hint={
          multiple
            ? "Chaque dépôt forme un lot. Rien ne part en transcription avant que vous lanciez le lot."
            : "Rien ne part en transcription avant que vous la lanciez."
        }
      />
    </Card>
  );
}
