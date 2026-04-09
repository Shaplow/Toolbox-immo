import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listFontAssets } from "@/lib/fontAssets";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const fonts = await listFontAssets();
    return NextResponse.json(fonts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chargement impossible";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}