export const RENDER_PIPELINE = {
  IMAGE: "image",
  VIDEO_LOCAL: "video-local",
  VIDEO_RUNPOD: "video-runpod",
} as const;

export const RENDER_STAGE = {
  QUEUED: "QUEUED",
  LOAD_RENDER: "LOAD_RENDER",
  VALIDATE_LISTING: "VALIDATE_LISTING",
  IMAGE_BUILD_HTML: "IMAGE_BUILD_HTML",
  IMAGE_RENDER_PNG: "IMAGE_RENDER_PNG",
  IMAGE_RENDER_PDF: "IMAGE_RENDER_PDF",
  VIDEO_PREPARE: "VIDEO_PREPARE",
  VIDEO_RENDER_OVERLAY: "VIDEO_RENDER_OVERLAY",
  VIDEO_UPLOAD_OVERLAY: "VIDEO_UPLOAD_OVERLAY",
  VIDEO_RESOLVE_SOURCE: "VIDEO_RESOLVE_SOURCE",
  VIDEO_SUBMIT_RUNPOD: "VIDEO_SUBMIT_RUNPOD",
  VIDEO_RUNPOD_QUEUED: "VIDEO_RUNPOD_QUEUED",
  VIDEO_RUNPOD_PROCESSING: "VIDEO_RUNPOD_PROCESSING",
  VIDEO_LOCAL_SEND: "VIDEO_LOCAL_SEND",
  VIDEO_LOCAL_COMPOSITING: "VIDEO_LOCAL_COMPOSITING",
  VIDEO_FINALIZING: "VIDEO_FINALIZING",
  DONE: "DONE",
  ERROR: "ERROR",
  STALLED: "STALLED",
} as const;

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "En file d'attente",
  LOAD_RENDER: "Préparation du rendu",
  VALIDATE_LISTING: "Validation des données",
  IMAGE_BUILD_HTML: "Construction du visuel",
  IMAGE_RENDER_PNG: "Export PNG",
  IMAGE_RENDER_PDF: "Export PDF",
  VIDEO_PREPARE: "Préparation vidéo",
  VIDEO_RENDER_OVERLAY: "Création de l'overlay",
  VIDEO_UPLOAD_OVERLAY: "Upload de l'overlay",
  VIDEO_RESOLVE_SOURCE: "Préparation de la source vidéo",
  VIDEO_SUBMIT_RUNPOD: "Soumission RunPod",
  VIDEO_RUNPOD_QUEUED: "RunPod en attente",
  VIDEO_RUNPOD_PROCESSING: "RunPod encode la vidéo",
  VIDEO_LOCAL_SEND: "Envoi au moteur vidéo",
  VIDEO_LOCAL_COMPOSITING: "Composite vidéo local",
  VIDEO_FINALIZING: "Finalisation du MP4",
  DONE: "Terminé",
  ERROR: "Erreur",
  STALLED: "Rendu bloqué",
};

export function getRenderStageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LABELS[stage] ?? stage;
}
