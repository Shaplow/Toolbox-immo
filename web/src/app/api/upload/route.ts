import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { uploadToR2, r2Configured } from "@/lib/r2";
import { createWriteStream, mkdir as mkdirCb } from "fs";
import { promisify } from "util";
import path from "path";
import Busboy from "busboy";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { stat, unlink } from "fs/promises";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";

const mkdir = promisify(mkdirCb);

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
// Chemin traversant le serveur (busboy → disque) : plafonds bornés par nginx.
const MAX_IMAGE_SIZE = UPLOAD_LIMITS.IMAGE_MAX_BYTES;
const MAX_VIDEO_SIZE = UPLOAD_LIMITS.VIDEO_ASSET_MAX_BYTES;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// Désactive le body parsing de Next.js — on gère le stream nous-même
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Requête multipart attendue" }, { status: 400 });
  }

  return new Promise<NextResponse>((resolve) => {
    const bb = Busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: MAX_VIDEO_SIZE },
    });

    let handled = false;

    bb.on("file", (fieldname, fileStream, info) => {
      const { filename: origName, mimeType } = info;

      if (!ALLOWED_TYPES.includes(mimeType)) {
        fileStream.resume(); // drain
        if (!handled) { handled = true; resolve(NextResponse.json({ error: "Type de fichier non supporté" }, { status: 400 })); }
        return;
      }

      // Marquer immédiatement : un fichier est en cours de traitement.
      // Empêche bb.on("finish") de résoudre avec "Fichier manquant" pendant que
      // l'upload R2 / écriture disque est encore en cours (asynchrone).
      handled = true;

      const isVideo = ALLOWED_VIDEO_TYPES.includes(mimeType);
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      let receivedBytes = 0;
      let sizeExceeded = false;

      const ext = origName.split(".").pop() ?? "bin";
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const useRunpod = process.env.USE_RUNPOD !== "false";
      const tempFilename = `${filename}.part`;
      const tempFilepath = path.join(UPLOAD_DIR, tempFilename);
      const finalFilepath = path.join(UPLOAD_DIR, filename);

      mkdir(UPLOAD_DIR, { recursive: true })
        .then(() => {
          const ws = createWriteStream(tempFilepath);

          fileStream.on("data", (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (!sizeExceeded && receivedBytes > maxSize) {
              sizeExceeded = true;
              fileStream.unpipe(ws);
              fileStream.resume();
              ws.destroy(new Error("FILE_TOO_LARGE"));
              void unlink(tempFilepath).catch(() => undefined);
              resolve(NextResponse.json({
                error: `Fichier trop volumineux (max ${isVideo ? "2000" : "50"} MB)`,
              }, { status: 400 }));
            }
          });

          fileStream.on("error", (err) => {
            console.error("[upload] source stream error:", err);
            ws.destroy(err);
          });

          fileStream.pipe(ws);

          ws.on("finish", async () => {
            if (sizeExceeded) {
              return;
            }

            try {
              if (useRunpod && r2Configured()) {
                const fileStats = await stat(tempFilepath);
                const key = `uploads/${filename}`;
                const result = await uploadToR2(
                  key,
                  createReadStream(tempFilepath),
                  mimeType,
                  fileStats.size
                );
                await unlink(tempFilepath).catch(() => undefined);
                resolve(NextResponse.json({ url: result.url }, { status: 201 }));
                return;
              }

              await stat(tempFilepath);
              await import("fs/promises").then(({ rename }) => rename(tempFilepath, finalFilepath));
              resolve(NextResponse.json({ url: `/uploads/${filename}` }, { status: 201 }));
            } catch (err) {
              console.error("[upload] finalize failed:", err);
              await unlink(tempFilepath).catch(() => undefined);
              resolve(NextResponse.json({ error: useRunpod && r2Configured() ? "Échec upload R2" : "Échec écriture locale" }, { status: 500 }));
            }
          });

          ws.on("error", (err) => {
            if (sizeExceeded) {
              return;
            }
            console.error("[upload] write failed:", err);
            void unlink(tempFilepath).catch(() => undefined);
            resolve(NextResponse.json({ error: "Échec écriture temporaire" }, { status: 500 }));
          });
        })
        .catch((err) => {
          console.error("[upload] mkdir failed:", err);
          resolve(NextResponse.json({ error: "Erreur serveur" }, { status: 500 }));
        });
    });

    bb.on("error", (err) => {
      console.error("[upload] busboy error:", err);
      if (!handled) { handled = true; resolve(NextResponse.json({ error: "Erreur parsing upload" }, { status: 500 })); }
    });

    bb.on("finish", () => {
      if (!handled) { handled = true; resolve(NextResponse.json({ error: "Fichier manquant" }, { status: 400 })); }
    });

    // Pipe le body stream Node.js vers busboy
    const nodeBody = req.body;
    if (!nodeBody) {
      resolve(NextResponse.json({ error: "Corps de requête manquant" }, { status: 400 }));
      return;
    }
    const nodeReadable = Readable.fromWeb(nodeBody as import("stream/web").ReadableStream<Uint8Array>);
    req.signal.addEventListener("abort", () => {
      nodeReadable.destroy(new Error("REQUEST_ABORTED"));
      bb.removeAllListeners();
    }, { once: true });
    nodeReadable.on("error", (err) => {
      if (err instanceof Error && err.message === "REQUEST_ABORTED") {
        return;
      }
      console.error("[upload] stream error:", err);
      if (!handled) { handled = true; resolve(NextResponse.json({ error: "Erreur stream upload" }, { status: 500 })); }
    });
    nodeReadable.pipe(bb);
  });
}
