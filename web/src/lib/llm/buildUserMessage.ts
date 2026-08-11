/**
 * buildUserMessage — assemblage du message utilisateur envoyé au LLM.
 *
 * Extrait tel quel de `api/description/generate/route.ts`, à une différence près :
 * les libellés FR étaient codés en dur dans la fonction, ce qui la rendait
 * inutilisable pour un autre usage sans la dupliquer. Ils sont désormais injectés
 * (cf. `lib/llm/prompts.ts`).
 *
 * L'ordre des blocs est conservé à l'identique — c'est ce que les prompts existants
 * en base attendent, et le modifier changerait silencieusement les sorties de tous
 * les prompts déjà réglés par le user.
 */

import { MAX_TRANSCRIPT_CHARS } from "@/lib/transcription/transcriptText";
import type { MessageLabels } from "@/lib/llm/prompts";

export type BuildUserMessageInput = {
  /** Instructions du prompt sélectionné (DescriptionPrompt.prompt). */
  promptText: string;
  transcriptText?: string | null;
  /** Texte libre saisi par l'opérateur (personalization / infos complémentaires). */
  extraInfo?: string | null;
  hasImage?: boolean;
  labels: MessageLabels;
  maxTranscriptChars?: number;
};

/**
 * Concatène prompt + infos complémentaires + consigne image + transcription.
 *
 * Si aucune transcription n'est disponible, remplace le bloc par
 * `noTranscriptInstruction` — sans quoi le modèle inventerait le contenu manquant.
 */
export function buildUserMessage(input: BuildUserMessageInput): string {
  const {
    promptText,
    transcriptText,
    extraInfo,
    hasImage = false,
    labels,
    maxTranscriptChars = MAX_TRANSCRIPT_CHARS,
  } = input;

  const normalizedTranscript = transcriptText?.trim() ?? "";
  let msg = promptText + "\n\n";

  if (extraInfo?.trim()) {
    msg += `${labels.extraInfoLabel} :\n${extraInfo.trim()}\n\n`;
  }
  if (hasImage) {
    msg += `${labels.imageInstruction}\n\n`;
  }

  if (normalizedTranscript) {
    msg += `${labels.transcriptLabel} :\n${normalizedTranscript.slice(0, maxTranscriptChars)}`;
    return msg;
  }

  msg += labels.noTranscriptInstruction;
  return msg;
}
