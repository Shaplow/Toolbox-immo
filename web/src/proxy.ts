import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Middleware de protection des routes.
 *
 * Logique :
 * - /login          → public, redirige vers /home si déjà connecté
 * - /api/auth/*     → public (NextAuth handlers)
 * - /api/webhooks/* → public (callbacks RunPod, vérifiés par RUNPOD_WEBHOOK_SECRET)
 * - /api/preview/*  → public (rendu HTML template, protégé dans la route elle-même)
 * - /api/*          → authentification requise
 * - /(app)/*        → authentification requise (le layout (app) vérifie aussi)
 * - /*              → authentification requise par défaut
 *
 * Les vérifications de permissions fines (ex: captions, templates:edit)
 * sont faites dans chaque page/layout, pas ici, pour éviter des appels DB
 * à chaque requête.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Routes publiques — toujours accessibles
  if (pathname.startsWith("/api/auth")) return NextResponse.next();

  // Webhooks RunPod — protégés par RUNPOD_WEBHOOK_SECRET dans chaque handler
  if (pathname.startsWith("/api/webhooks/")) return NextResponse.next();

  // Route interne de génération — protégée par INTERNAL_API_KEY (pas de session)
  if (pathname.match(/^\/api\/renders\/[^/]+\/generate$/)) {
    const key = req.headers.get("x-internal-key");
    if (key && key === process.env.INTERNAL_API_KEY) return NextResponse.next();
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (pathname === "/login") {
    const session = await auth();
    if (session) return NextResponse.redirect(new URL("/home", req.url));
    return NextResponse.next();
  }

  // Tout le reste nécessite une session valide
  const session = await auth();
  if (!session?.user?.id) {
    // Requête API → 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    // Page → redirect login
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Applique le middleware à toutes les routes sauf :
     * - _next/static  (assets statiques)
     * - _next/image   (optimisation images)
     * - favicon.ico
     * - fichiers avec extension (images, fonts, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
