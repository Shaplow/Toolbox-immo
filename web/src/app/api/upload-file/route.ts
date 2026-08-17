/**
 * POST /api/upload-file — upload générique image/vidéo (R2 si configuré,
 * sinon public/uploads local).
 *
 * Migré du Pages Router (src/pages/api/upload-file.ts, dernier survivant) en
 * V1 17/08 : même URL, même contrat de réponse `{ url } | { error }`, même
 * streaming Busboy (pas de buffering en mémoire). L'auth passe par
 * requireUser() (V2.1) au lieu d'un fetch HTTP vers /api/auth/session. NB : aucun consommateur dans le repo au moment de la
 * migration — conservée pour d'éventuels appels hors repo.
 */
import { NextRequest, NextResponse } from "next/server";
import Busboy from "busboy";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";

import { requireUser } from "@/lib/api/requireAuth";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
// Chemin traversant le serveur : plafonds bornés par nginx.
const MAX_IMAGE_SIZE = UPLOAD_LIMITS.IMAGE_MAX_BYTES;
const MAX_VIDEO_SIZE = UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
};

type UploadResponse = {
  url?: string;
  error?: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Requête multipart attendue" }, { status: 400 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  // Busboy attend un stream Node — on adapte le ReadableStream web du body.
  const nodeStream = Readable.fromWeb(req.body as WebReadableStream);

  return new Promise<NextResponse<UploadResponse>>((resolve) => {
    const bb = Busboy({ headers: { "content-type": contentType } });
    let hasFile = false;
    let responded = false;

    const send = (status: number, payload: UploadResponse) => {
      if (responded) {
        return;
      }
      responded = true;
      resolve(NextResponse.json(payload, { status }));
    };

    bb.on("file", (_fieldName, fileStream, info) => {
      hasFile = true;

      const { mimeType } = info;
      if (!ALLOWED_TYPES.includes(mimeType)) {
        fileStream.resume();
        send(400, { error: "Type de fichier non supporté" });
        return;
      }

      const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      const ext = MIME_TO_EXT[mimeType] ?? "bin";
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const tmpPath = path.join(UPLOAD_DIR, `${filename}.part`);
      const finalPath = path.join(UPLOAD_DIR, filename);
      const useRunpod = process.env.USE_RUNPOD !== "false";

      let receivedBytes = 0;
      let sizeExceeded = false;
      const ws = createWriteStream(tmpPath);

      fileStream.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (!sizeExceeded && receivedBytes > maxSize) {
          sizeExceeded = true;
          fileStream.unpipe(ws);
          fileStream.resume();
          ws.destroy(new Error("FILE_TOO_LARGE"));
          void unlink(tmpPath).catch(() => undefined);
          send(400, { error: `Fichier trop volumineux (max ${isVideo ? "2000" : "50"} MB)` });
        }
      });

      fileStream.on("error", (error) => {
        if (responded) {
          return;
        }
        console.error("[upload-file] source stream error:", error);
        ws.destroy(error);
      });

      ws.on("error", (error) => {
        if (sizeExceeded || responded) {
          return;
        }
        console.error("[upload-file] temp write failed:", error);
        void unlink(tmpPath).catch(() => undefined);
        send(500, { error: "Échec écriture temporaire" });
      });

      ws.on("finish", async () => {
        if (sizeExceeded || responded) {
          return;
        }

        try {
          if (useRunpod && r2Configured()) {
            const fileStats = await stat(tmpPath);
            const key = `uploads/${filename}`;
            const result = await uploadToR2(key, createReadStream(tmpPath), mimeType, fileStats.size);
            await unlink(tmpPath).catch(() => undefined);
            send(201, { url: result.url });
            return;
          }

          await rename(tmpPath, finalPath);
          send(201, { url: `/uploads/${filename}` });
        } catch (error) {
          console.error("[upload-file] finalize failed:", error);
          await unlink(tmpPath).catch(() => undefined);
          send(500, { error: useRunpod && r2Configured() ? "Échec upload R2" : "Échec écriture locale" });
        }
      });

      fileStream.pipe(ws);
    });

    bb.on("error", (error) => {
      console.error("[upload-file] busboy error:", error);
      send(500, { error: "Erreur parsing upload" });
    });

    bb.on("finish", () => {
      if (!hasFile) {
        send(400, { error: "Fichier manquant" });
      }
    });

    // Client parti en cours d'upload : la réponse ne sera jamais lue, mais la
    // Promise doit se résoudre pour libérer le worker.
    nodeStream.on("error", (error) => {
      console.error("[upload-file] request stream error:", error);
      send(400, { error: "Upload interrompu" });
    });

    nodeStream.pipe(bb);
  });
}
