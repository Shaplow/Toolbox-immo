import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAuth";
import { syncLegacyPublicFonts } from "@/lib/fontAssets";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const fonts = await syncLegacyPublicFonts();
    return NextResponse.json(fonts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronisation impossible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
