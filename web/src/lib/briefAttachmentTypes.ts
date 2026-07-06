/**
 * Types MIME acceptés pour les pièces jointes d'un brief éditorial.
 * Source unique partagée entre le client (MediaDropzone `accept`) et le serveur
 * (upload-presign `ALLOWED_CONTENT_TYPES["brief-attachment"]`) pour éviter la
 * divergence. Large : documents, images, audio (mp3/wav…), vidéo légère.
 */
export const BRIEF_ATTACHMENT_MIME_TYPES: string[] = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/aac",
  // Vidéo légère
  "video/mp4",
  "video/quicktime",
  "video/webm",
];
