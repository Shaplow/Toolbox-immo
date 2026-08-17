import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { listFontAssets } from "@/lib/fontAssets";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const fonts = await listFontAssets();
    return NextResponse.json(fonts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chargement impossible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
