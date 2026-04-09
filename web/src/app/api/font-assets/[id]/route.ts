import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { deleteFontAssetById, getFontAssetById } from "@/lib/fontAssets";
import { deleteFromR2, r2Configured } from "@/lib/r2";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  const asset = await getFontAssetById(id);
  if (!asset) {
    return NextResponse.json({ error: "Typographie introuvable" }, { status: 404 });
  }

  try {
    if (asset.storageKey?.startsWith("fonts/") && /^https?:\/\//i.test(asset.url) && r2Configured()) {
      await deleteFromR2(asset.storageKey);
    } else if (asset.url.startsWith("/fonts/")) {
      const relative = asset.url.slice(1);
      await unlink(path.join(process.cwd(), "public", relative)).catch(() => undefined);
    }

    await deleteFontAssetById(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Suppression impossible" },
      { status: 500 }
    );
  }
}