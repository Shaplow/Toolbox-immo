import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

/**
 * Proxy transparent vers le microservice Python render-engine.
 * Toutes les requêtes vers /api/captions/[...path] sont forwardées
 * vers CAPTIONS_API_URL/[...path] avec l'API key interne.
 *
 * Sécurité :
 * - L'utilisateur doit être authentifié (session valide)
 * - Le microservice Python vérifiera X-Internal-Key (Étape 3)
 */

async function proxyRequest(req: NextRequest, path: string[]): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const targetPath = "/" + path.join("/");
  const targetUrl = `${CAPTIONS_API}${targetPath}${req.nextUrl.search}`;

  const headers = new Headers();
  // Forward Content-Type si présent (pour multipart/form-data notamment)
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  // Forward Range header for video streaming (partial content / seeking)
  const range = req.headers.get("range");
  if (range) headers.set("range", range);
  // API key interne (validée côté Python à l'Étape 3)
  if (process.env.INTERNAL_API_KEY) {
    headers.set("x-internal-key", process.env.INTERNAL_API_KEY);
  }
  // Identité de l'utilisateur loggué (pour logs côté Python)
  headers.set("x-user-id", session.user.id);

  try {
    const body = req.method !== "GET" && req.method !== "HEAD"
      ? await req.arrayBuffer()
      : undefined;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body ? Buffer.from(body) : undefined,
      // Don't let Next.js cache static assets from the render engine
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    // Forward all relevant headers
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"]) {
      const val = upstream.headers.get(key);
      if (val) responseHeaders.set(key, val);
    }

    // Pipe the body as a stream — never buffer large binary files in memory
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[captions-proxy] Erreur connexion upstream:", err);
    return NextResponse.json(
      { error: "Service captions indisponible", detail: String(err) },
      { status: 503 }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}
