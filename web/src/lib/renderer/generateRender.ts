import { prisma } from "@/lib/prisma";
import { buildHTML } from "./buildHTML";
import { renderPNG } from "./renderPNG";
import { renderPDF } from "./renderPDF";
import { validateConformite } from "@/lib/validation/conformite";
import type { TemplateJSON, CanvasFormat, ImageBlock, VideoBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { writeFile, mkdir, stat, readFile } from "fs/promises";
import path from "path";
import { uploadToR2, r2Configured } from "@/lib/r2";

const OUTPUT_DIR = path.join(process.cwd(), "public", "renders");

/** Minimum file size in bytes to be considered adequate resolution (~100KB for photos) */
const MIN_IMAGE_BYTES = 100_000;
/** Minimum pixels for a print-ready image at 300dpi A3 */
const MIN_PRINT_PX = 800;

async function collectImageWarnings(
  templateJson: TemplateJSON,
  listingData: ListingData
): Promise<string[]> {
  const warnings: string[] = [];
  const imageBlocks = templateJson.blocks.filter((b) => b.type === "image") as ImageBlock[];

  for (const block of imageBlocks) {
    const binding = block.binding;
    if (!binding) continue;
    const value = (listingData as Record<string, unknown>)[binding];
    if (typeof value !== "string" || !value) continue;

    // Only check local uploads
    if (!value.startsWith("/uploads/")) continue;
    const filePath = path.join(process.cwd(), "public", value);
    try {
      const info = await stat(filePath);
      if (info.size < MIN_IMAGE_BYTES) {
        warnings.push(
          `Image "${binding}" semble de faible résolution (${Math.round(info.size / 1024)} Ko — recommandé > ${Math.round(MIN_IMAGE_BYTES / 1024)} Ko pour l'impression).`
        );
      }
      // Check against canvas dimensions
      const { width, height } = templateJson.canvas;
      const blockPx = Math.max(block.w, block.h);
      if (blockPx > MIN_PRINT_PX && info.size < 300_000) {
        const already = warnings.some((w) => w.includes(binding));
        if (!already) {
          warnings.push(
            `Image "${binding}" peut être pixelisée à l'impression (bloc ${block.w}×${block.h}px sur canvas ${width}×${height}px).`
          );
        }
      }
    } catch {
      // File not found — not a local upload warning
    }
  }
  return warnings;
}

export async function generateRender(renderId: string): Promise<void> {
  // 1. Charger render + listing + template
  const render = await prisma.render.findUniqueOrThrow({ where: { id: renderId } });
  const listing = await prisma.listing.findUniqueOrThrow({ where: { id: render.listingId } });
  if (!render.templateId) {
    await prisma.render.update({
      where: { id: renderId },
      data: { status: "ERROR", errorMsg: "Template supprimé" },
    });
    return;
  }
  const template = await prisma.template.findUniqueOrThrow({ where: { id: render.templateId } });

  const templateJson = JSON.parse(template.jsonData) as TemplateJSON;
  const listingData = JSON.parse(listing.jsonData) as ListingData;

  // 2. Validation conformité (enrichissement auto)
  const { enrichedListing } = validateConformite(listingData);

  // ─── Branchement : vidéo (RunPod) vs image (Node.js) ─────────────────────
  const videoBlocks = templateJson.blocks.filter((b) => b.type === "video") as VideoBlock[];
  if (videoBlocks.length > 0) {
    await generateVideoRender(renderId, templateJson, enrichedListing, videoBlocks);
    return;
  }

  // 3. Collect image resolution warnings
  const warnings = await collectImageWarnings(templateJson, enrichedListing);
  if (warnings.length > 0) {
    console.warn(`[Renderer] ${renderId} — Avertissements résolution :`, warnings);
  }

  // 4. Build HTML (avec résolution des polices locales pour Puppeteer)
  const publicBase = "file://" + path.join(process.cwd(), "public").replace(/\\/g, "/");
  const html = await buildHTML(templateJson, enrichedListing, { publicBase });

  const { canvas } = templateJson;
  const { width, height } = canvas;

  // 5. Créer dossier de sortie
  await mkdir(OUTPUT_DIR, { recursive: true });

  // 6. Générer PNG
  const pngBuffer = await renderPNG(html, width, height);
  const pngFilename = `${renderId}.png`;
  await writeFile(path.join(OUTPUT_DIR, pngFilename), pngBuffer);

  // 7. Générer PDF
  const pdfBuffer = await renderPDF(html, canvas.format as CanvasFormat, width, height);
  const pdfFilename = `${renderId}.pdf`;
  await writeFile(path.join(OUTPUT_DIR, pdfFilename), pdfBuffer);

  // 8. Mettre à jour le render en DB (avec avertissements éventuels)
  await prisma.render.update({
    where: { id: renderId },
    data: {
      status: "DONE",
      pngUrl: `/renders/${pngFilename}`,
      pdfUrl: `/renders/${pdfFilename}`,
      errorMsg: warnings.length > 0
        ? `WARNINGS:${JSON.stringify(warnings)}`
        : null,
    },
  });
}

// ─── Pipeline vidéo (RunPod ou local) ────────────────────────────────────────

async function generateVideoRender(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  videoBlocks: VideoBlock[],
): Promise<void> {
  const useRunpod = process.env.USE_RUNPOD !== "false";
  if (!useRunpod) {
    await generateVideoRenderLocal(renderId, templateJson, listingData, videoBlocks);
    return;
  }
  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
  const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    await prisma.render.update({
      where: { id: renderId },
      data: { status: "ERROR", errorMsg: "RunPod non configuré (RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID manquants)" },
    });
    return;
  }
  if (!r2Configured()) {
    await prisma.render.update({
      where: { id: renderId },
      data: { status: "ERROR", errorMsg: "R2 non configuré — requis pour les renders vidéo" },
    });
    return;
  }

  await prisma.render.update({ where: { id: renderId }, data: { status: "PROCESSING" } });

  try {
    const { width, height } = templateJson.canvas;

    // 1. Rendre le template en PNG avec fond transparent + blocs vidéo transparents (overlay)
    const overlayHtml = await buildHTML(templateJson, listingData, { overlayMode: true });
    const overlayBuffer = await renderPNG(overlayHtml, width, height, 1, true);

    // 2. Uploader l'overlay vers R2
    const { url: overlayUrl } = await uploadToR2(
      `overlays/${renderId}.png`,
      overlayBuffer,
      "image/png"
    );

    // 3. Récupérer l'URL vidéo depuis le listing (premier bloc vidéo avec binding)
    const videoBlock = videoBlocks[0];
    const videoUrl = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;

    if (!videoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire`
      );
    }

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // 4. Soumettre le job RunPod
    const outputKey = `renders/${renderId}.mp4`;
    const runpodRes = await fetch(
      `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            job_type: "render_template",
            overlay_url: overlayUrl,
            video_url: videoUrl,
            video_block: {
              x: videoBlock.x,
              y: videoBlock.y,
              w: videoBlock.w,
              h: videoBlock.h,
              fit: videoBlock.fit ?? "cover",
              crop_x,
              crop_y,
            },
            canvas: { width, height },
            output_key: outputKey,
            render_id: renderId,
          },
        }),
      }
    );

    if (!runpodRes.ok) {
      throw new Error(`RunPod submit ${runpodRes.status}: ${await runpodRes.text()}`);
    }

    const runpodData = (await runpodRes.json()) as { id: string };

    // 5. Stocker le runpodJobId — le polling dans GET /api/renders/:id terminera le job
    await prisma.render.update({
      where: { id: renderId },
      data: { runpodJobId: runpodData.id },
    });
  } catch (err) {
    await prisma.render.update({
      where: { id: renderId },
      data: {
        status: "ERROR",
        errorMsg: err instanceof Error ? err.message : "Erreur génération vidéo",
      },
    });
  }
}
// ─── Pipeline vidéo LOCAL (sans RunPod) ──────────────────────────────────────

async function generateVideoRenderLocal(
  renderId: string,
  templateJson: TemplateJSON,
  listingData: ListingData,
  videoBlocks: VideoBlock[],
): Promise<void> {
  await prisma.render.update({ where: { id: renderId }, data: { status: "PROCESSING" } });

  try {
    const { width, height } = templateJson.canvas;
    const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
    const baseUrl = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

    // 1. Overlay PNG transparent (canvas + textes, pas de fond vidéo)
    const overlayHtml = await buildHTML(templateJson, listingData, { overlayMode: true });
    const overlayBuffer = await renderPNG(overlayHtml, width, height, 1, true);

    // 2. Résoudre l'URL de la vidéo source
    const videoBlock = videoBlocks[0];
    const rawVideoUrl = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding] as string | undefined
      : undefined;

    if (!rawVideoUrl) {
      throw new Error(
        `Bloc vidéo sans URL : renseigne la variable "${videoBlock.binding ?? "(pas de binding)"}" dans le formulaire`
      );
    }
    console.log(`[generateRender] rawVideoUrl = "${rawVideoUrl}"`);
    const absoluteVideoUrl = rawVideoUrl.startsWith("http") ? rawVideoUrl : `${baseUrl}${rawVideoUrl}`;

    // Cadrage personnalisé (focal point défini par l'user dans le formulaire)
    const focalPoint = videoBlock.binding
      ? (listingData as Record<string, unknown>)[videoBlock.binding + "_focalpoint"] as { x: number; y: number } | null | undefined
      : null;
    const crop_x = focalPoint?.x ?? 0.5;
    const crop_y = focalPoint?.y ?? 0.5;

    // 3. Envoyer overlay + vidéo à render-engine pour composite FFmpeg
    const form = new FormData();
    form.append("overlay", new Blob([new Uint8Array(overlayBuffer)], { type: "image/png" }), "overlay.png");
    form.append("video_block", JSON.stringify({
      x: videoBlock.x, y: videoBlock.y, w: videoBlock.w, h: videoBlock.h,
      fit: videoBlock.fit ?? "cover",
      crop_x,
      crop_y,
    }));
    form.append("canvas_w", String(width));
    form.append("canvas_h", String(height));

    // Vidéo locale → envoyer en binaire (évite les problèmes DNS inter-containers Docker)
    // Vidéo distante (http/https) → envoyer l'URL
    if (rawVideoUrl.startsWith("/")) {
      const videoFilePath = path.join(process.cwd(), "public", rawVideoUrl);
      const videoBytes = await readFile(videoFilePath);
      console.log(`[generateRender] Video local file: ${videoFilePath} — ${videoBytes.length} bytes`);
      if (videoBytes.length === 0) {
        throw new Error(`Fichier vidéo vide : ${videoFilePath}`);
      }
      form.append("video", new Blob([videoBytes], { type: "video/mp4" }), "video.mp4");
    } else {
      form.append("video_url", absoluteVideoUrl);
    }

    const res = await fetch(`${CAPTIONS_API}/api/render_template`, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`render-engine ${res.status}: ${await res.text()}`);
    }

    // Le render-engine retourne les bytes directement (StreamingResponse)
    const videoBuffer = Buffer.from(await res.arrayBuffer());
    const videoFilename = `${renderId}.mp4`;
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, videoFilename), videoBuffer);
    const finalUrl = `/renders/${videoFilename}`;

    await prisma.render.update({
      where: { id: renderId },
      data: { status: "DONE", videoUrl: finalUrl },
    });
  } catch (err) {
    await prisma.render.update({
      where: { id: renderId },
      data: {
        status: "ERROR",
        errorMsg: err instanceof Error ? err.message : "Erreur génération vidéo locale",
      },
    });
  }
}