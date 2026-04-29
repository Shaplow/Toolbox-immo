export interface MediaEditParams {
  /** Secondes depuis le début à partir desquelles garder la vidéo (coupe le début) */
  trimStart?: number;
  /** Secondes depuis le début jusqu'auxquelles garder la vidéo (coupe la fin) */
  trimEnd?: number;
  /**
   * Fusionner L+R en mono centré sur les deux canaux (utile quand un micro mono
   * est branché uniquement sur le canal gauche ou droit).
   */
  mixToMono?: boolean;
  /** Normaliser le volume avec loudnorm (EBU R128, I=-16 LUFS). */
  normalize?: boolean;
}

export type MediaEditJobStatus = "pending" | "processing" | "done" | "failed";

export interface MediaEditJob {
  id: string;
  assetId: string;
  status: MediaEditJobStatus;
  params: MediaEditParams;
  runpodId?: string | null;
  errorMsg?: string | null;
  createdAt: string;
  updatedAt: string;
}
