import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { requireUser } from "@/lib/api/requireAuth";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

type Frame = { timestamp: number; url: string };

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

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

  if (videoUrl.startsWith("/api/captions/")) {
    // Render local : la vidéo vit dans le workspace du render-engine (FastAPI),
    // pas dans public/. On la passe en URL absolue loopback vers CAPTIONS_API
    // pour que le render-engine fetch son propre fichier (pas de lecture
    // disque possible côté web). Cas typique : slot auto_template avec
    // pipeline VIDEO_LOCAL / SEQUENCE_LOCAL → render.videoUrl pré-rempli sur
    // la page cover. Sans ce path, le pré-fill cassait avec un 404
    // "Fichier vidéo introuvable" car path.join(public, /api/captions/…)
    // ne trouve rien.
    const enginePath = videoUrl.replace(/^\/api\/captions\//, "");
    form.append("video_url", `${CAPTIONS_API}/${enginePath}`);
  } else if (videoUrl.startsWith("/")) {
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
    // URL distante (R2 / CDN) : valider que le schéma est http(s) et le domaine est autorisé
    // pour éviter les requêtes SSRF vers des services internes (metadata cloud, render-engine, etc.)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      return NextResponse.json({ error: "videoUrl invalide" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return NextResponse.json({ error: "videoUrl doit être une URL http(s)" }, { status: 400 });
    }

    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    const allowedHosts: string[] = [];
    if (r2PublicUrl) {
      try { allowedHosts.push(new URL(r2PublicUrl).hostname); } catch { /* ignore */ }
    }
    // Allow public CDN/R2 hostname patterns — block private/internal IP ranges
    const hostname = parsedUrl.hostname;
    const isPrivateIp =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) || // link-local / AWS metadata
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local");

    if (isPrivateIp) {
      return NextResponse.json({ error: "videoUrl pointe vers un réseau privé" }, { status: 400 });
    }

    // Le render engine peut télécharger directement cette URL publique
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
    // Le render-engine renvoie { detail: "..." } (FastAPI). On extrait le message
    // plutôt que de renvoyer le JSON brut, qui se retrouvait tel quel dans le toast.
    const raw = await res.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch { /* corps non-JSON — on garde le texte brut */ }
    return NextResponse.json({ error: message.slice(0, 400) }, { status: res.status });
  }

  const data = await res.json() as Frame[];

  // Rewrite engine-relative URLs to go through the authenticated Next.js proxy
  const frames: Frame[] = data.map((f) => ({
    ...f,
    url: f.url.startsWith("/") ? `/api/captions${f.url}` : f.url,
  }));

  return NextResponse.json(frames);
}
