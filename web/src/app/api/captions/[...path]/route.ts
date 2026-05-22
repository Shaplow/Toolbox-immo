import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCaptionCompatibleFontAsset, listFontAssetsByFamilies } from "@/lib/fontAssets";
import { normalizeCaptionConfig } from "@/lib/captionsEngine";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

// Paths on the render-engine that authenticated users may proxy to.
// Anything not in this set returns 404 instead of leaking internal endpoints.
const ALLOWED_PATHS = new Set([
  "/api/preview",
  "/api/render",
  "/api/status",
  "/api/font-files",
  "/health",
]);

function isAllowedPath(targetPath: string): boolean {
  // Exact match or allow /api/status/<id> sub-paths
  if (ALLOWED_PATHS.has(targetPath)) return true;
  if (targetPath.startsWith("/api/status/")) return true;
  if (targetPath.startsWith("/outputs/")) return true;
  return false;
}

/**
 * Proxy transparent vers le microservice Python render-engine.
 * Toutes les requêtes vers /api/captions/[...path] sont forwardées
 * vers CAPTIONS_API_URL/[...path] avec l'API key interne.
 *
 * Sécurité :
 * - L'utilisateur doit être authentifié (session valide)
 * - Seuls les chemins de l'allowlist ALLOWED_PATHS sont acceptés
 * - Le microservice Python vérifiera X-Internal-Key (Étape 3)
 */

async function proxyRequest(req: NextRequest, path: string[]): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const targetPath = "/" + path.join("/");

  if (!isAllowedPath(targetPath)) {
    return NextResponse.json({ error: "Chemin non autorisé" }, { status: 404 });
  }

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
    let body: ArrayBuffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const shouldAugmentConfig = req.method === "POST" && (targetPath === "/api/preview" || targetPath === "/api/render");

      if (shouldAugmentConfig) {
        const formData = await req.formData();
        const configRaw = formData.get("config");

        if (typeof configRaw === "string") {
          try {
            const configData = JSON.parse(configRaw) as Record<string, unknown>;
            const baseFont = (configData.base as { font?: string } | undefined)?.font;
            const highlightFont = (configData.highlight as { font?: string } | undefined)?.font;
            const highlight2 = configData.highlight2 as { enabled?: boolean; font?: string } | undefined;
            const fontFamilies = [baseFont, highlightFont, highlight2?.enabled ? highlight2.font : undefined]
              .map((font) => font?.trim())
              .filter(Boolean) as string[];

            if (fontFamilies.length > 0) {
              const fontAssets = (await listFontAssetsByFamilies([...new Set(fontFamilies)]))
                .filter(isCaptionCompatibleFontAsset)
                .map((asset) => ({ family: asset.family, url: asset.url, originalName: asset.originalName }));
              if (fontAssets.length > 0) {
                formData.set("config", JSON.stringify(normalizeCaptionConfig({ ...configData, font_assets: fontAssets })));
              } else {
                formData.set("config", JSON.stringify(normalizeCaptionConfig(configData)));
              }
            } else {
              formData.set("config", JSON.stringify(normalizeCaptionConfig(configData)));
            }
          } catch {
            // no-op, laisse le backend retourner l'erreur si besoin
          }
        }

        const rebuilt = new Response(formData);
        const contentType = rebuilt.headers.get("content-type");
        if (contentType) headers.set("content-type", contentType);
        body = await rebuilt.arrayBuffer();
      } else {
        body = await req.arrayBuffer();
      }
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
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
