import type { ImageBlock } from "@/types/template";
import type { ListingData } from "@/types/listing";
import { blockBaseStyle } from "../styleUtils";
import path from "path";
import { readFile } from "fs/promises";

async function toBase64DataUri(src: string): Promise<string> {
  if (src.startsWith("/")) {
    // Local file — read from disk
    try {
      const filePath = path.join(process.cwd(), "public", src);
      const buffer = await readFile(filePath);
      const ext = src.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeMap: Record<string, string> = {
        png: "image/png", webp: "image/webp", gif: "image/gif",
        svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg",
      };
      const mime = mimeMap[ext] ?? "image/jpeg";
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return "";
    }
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    // Remote URL — fetch and embed as base64 so Puppeteer doesn't need network
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return "";
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const mime = contentType.split(";")[0].trim();
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return "";
    }
  }

  return src;
}

export async function renderImageBlock(
  block: ImageBlock,
  listing: ListingData
): Promise<string> {
  let src = "";

  if (block.staticSrc) {
    src = block.staticSrc;
  } else if (block.binding) {
    src = String(listing[block.binding] ?? "");
  }

  if (!src) {
    return `<div class="block" style="${blockBaseStyle(block)}background:#E5E5E5;${block.borderRadius ? `border-radius:${block.borderRadius}px;` : ""}"></div>`;
  }

  const imgSrc = await toBase64DataUri(src);

  // Per-listing focal point (set in generation form) takes priority over block-level focal
  const listingFocal = block.binding
    ? (listing[block.binding + "_focalpoint"] as { x: number; y: number } | undefined)
    : undefined;
  const focalX = listingFocal?.x ?? block.focalX;
  const focalY = listingFocal?.y ?? block.focalY;
  const objectPosition = focalX !== undefined && focalY !== undefined
    ? `object-position:${focalX * 100}% ${focalY * 100}%`
    : "";

  const borderRadius = block.borderRadius ? `border-radius:${block.borderRadius}px;` : "";
  const fit = block.fit === "contain" ? "contain" : "cover";

  return imgSrc
    ? `<div class="block block-image block-image-${fit}" style="${blockBaseStyle(block)}${borderRadius}overflow:hidden;">
        <img src="${imgSrc}" style="width:100%;height:100%;object-fit:${fit};${objectPosition}" alt="" />
      </div>`
    : `<div class="block" style="${blockBaseStyle(block)}background:#E5E5E5;${borderRadius}"></div>`;
}
