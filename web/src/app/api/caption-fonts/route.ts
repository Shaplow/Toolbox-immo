import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCaptionCompatibleFontAsset, listFontAssets } from "@/lib/fontAssets";

/**
 * Fallback statique — noms exacts comme retournés par /api/fonts de la Python API.
 * Ordre : Playfair Display en premier (police principale Bonjour Oscar), puis le reste.
 */
const STATIC_FONTS: string[] = [
  // Playfair Display — variantes
  "Playfair Display SemiBold",
  "Playfair Display SemiBold Italic",
  "Playfair Display Bold",
  "Playfair Display Bold Italic",
  "Playfair Display Black",
  "Playfair Display Black Italic",
  "Playfair Display ExtraBold",
  "Playfair Display ExtraBold Italic",
  "Playfair Display Medium",
  "Playfair Display Medium Italic",
  "Playfair Display Regular",
  "Playfair Display Italic",
  // Didot — variantes
  "Didot",
  "Didot Italic",
  "Didot Bold",
  "Didot Title",
  // Autres
  "Bebas Neue Regular",
  "Glacial Indifference Regular",
  "harmonyos sans bold",
  "Kugile Demo",
  "luxury",
  "Oswald Regular Italic 400",
];

/**
 * GET /api/caption-fonts
 * Retourne la liste des polices disponibles.
 * Essaie d'abord la Python API (source of truth), fallback sur STATIC_FONTS.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const captionsApiUrl = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";
  const compatibleGlobalFonts = (await listFontAssets())
    .filter(isCaptionCompatibleFontAsset)
    .map((font) => font.family);

  function buildResponse(fonts: string[], source: "api" | "fallback" | "merged") {
    const merged = [...new Set([...fonts, ...compatibleGlobalFonts])].sort((a, b) =>
      a.localeCompare(b, "fr", { sensitivity: "base" })
    );
    return NextResponse.json({ fonts: merged, source });
  }

  try {
    const res = await fetch(`${captionsApiUrl}/api/fonts`, {
      headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as { fonts: string[] };
      if (Array.isArray(data.fonts) && data.fonts.length > 0) {
        return buildResponse(data.fonts, "merged");
      }
    }
  } catch {
    // Python API indisponible → fallback ci-dessous
  }

  return buildResponse(STATIC_FONTS, "fallback");
}
