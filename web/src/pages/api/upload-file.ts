import type { NextApiRequest, NextApiResponse } from "next";
import Busboy from "busboy";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";

import { r2Configured, uploadToR2 } from "@/lib/r2";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
// Chemin traversant le serveur (Pages Router) : plafonds bornés par nginx.
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

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

type UploadResponse = {
  url?: string;
  error?: string;
};

async function hasAuthenticatedUser(req: NextApiRequest): Promise<boolean> {
  const cookie = req.headers.cookie;
  if (!cookie) {
    return false;
  }

  const baseUrl = process.env.NEXTAUTH_URL_INTERNAL
    ?? process.env.NEXTAUTH_URL
    ?? "http://127.0.0.1:3000";

  try {
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: {
        cookie,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const session = await response.json() as { user?: { id?: string | null } | null };
    return Boolean(session.user?.id);
  } catch (error) {
    console.error("[upload-file] session check failed:", error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<UploadResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const isAuthenticated = await hasAuthenticatedUser(req);
  if (!isAuthenticated) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return res.status(400).json({ error: "Requête multipart attendue" });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  await new Promise<void>((resolve) => {
    const bb = Busboy({ headers: req.headers });
    let hasFile = false;
    let responded = false;

    const send = (status: number, payload: UploadResponse) => {
      if (responded) {
        return;
      }
      responded = true;
      res.status(status).json(payload);
      resolve();
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

    req.on("aborted", () => {
      if (!responded) {
        responded = true;
        resolve();
      }
    });

    req.pipe(bb);
  });
}