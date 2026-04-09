import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

type Frame = { timestamp: number; url: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: { videoUrl?: string; timestamps?: unknown };
  try {
    body = await req.json() as { videoUrl?: string; timestamps?: unknown };
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { videoUrl, timestamps } = body;

  if (!videoUrl || typeof videoUrl !== "string") {
    return NextResponse.json({ error: "videoUrl requis" }, { status: 400 });
  }
  if (!Array.isArray(timestamps) || timestamps.length === 0) {
    return NextResponse.json({ error: "timestamps requis (tableau non vide)" }, { status: 400 });
  }

  const form = new FormData();
  form.append("timestamps_json", JSON.stringify(timestamps));

  if (videoUrl.startsWith("/")) {
    // URL locale : lire le fichier sur disque et l'envoyer directement au render engine
    // (évite tout problème réseau cross-container Docker)
    const safePath = path.join(process.cwd(), "public", path.normalize(videoUrl));
    let buf: Buffer;
    try {
      buf = await readFile(safePath);
    } catch {
      return NextResponse.json({ error: "Fichier vidéo introuvable" }, { status: 404 });
    }
    form.append("video", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), path.basename(safePath));
  } else {
    // URL distante (R2 / CDN) : le render engine peut la télécharger directement
    form.append("video_url", videoUrl);
  }

  let res: Response;
  try {
    res = await fetch(`${CAPTIONS_API}/api/extract-covers`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Render engine inaccessible : ${String(err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const data = await res.json() as Frame[];

  // Rewrite engine-relative URLs to go through the authenticated Next.js proxy
  const frames: Frame[] = data.map((f) => ({
    ...f,
    url: f.url.startsWith("/") ? `/api/captions${f.url}` : f.url,
  }));

  return NextResponse.json(frames);
}
