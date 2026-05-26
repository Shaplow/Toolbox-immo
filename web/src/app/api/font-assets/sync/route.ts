import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { syncLegacyPublicFonts } from "@/lib/fontAssets";

export const dynamic = "force-dynamic";

export async function POST() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const fonts = await syncLegacyPublicFonts();
    return NextResponse.json(fonts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Synchronisation impossible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
