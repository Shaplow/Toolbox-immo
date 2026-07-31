import { NextRequest, NextResponse } from "next/server";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getUserContext } from "@/lib/userContext";

function toBrowserMediaUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/outputs/")) {
      return `/api/captions${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Relative URLs are handled below.
  }
  return url.startsWith("/outputs/") ? `/api/captions${url}` : url;
}

function readTemplateCanvas(jsonData: string | null | undefined): { canvasWidth: number; canvasHeight: number } {
  if (!jsonData) return { canvasWidth: 1080, canvasHeight: 1920 };
  try {
    const parsed = JSON.parse(jsonData) as { canvas?: { width?: unknown; height?: unknown } };
    const width = typeof parsed.canvas?.width === "number" && parsed.canvas.width > 0 ? parsed.canvas.width : 1080;
    const height = typeof parsed.canvas?.height === "number" && parsed.canvas.height > 0 ? parsed.canvas.height : 1920;
    return { canvasWidth: width, canvasHeight: height };
  } catch {
    return { canvasWidth: 1080, canvasHeight: 1920 };
  }
}

/** `parentGroupId` est exposé pour que l'UI puisse afficher un sous-groupe comme
 *  inclus dans son parent — cocher un parent inclut ses sous-groupes côté rendu
 *  (cf. `expandGroupIdsWithChildren`). */
type TemplateGroup = { id: string; name: string; hidden?: boolean; locked?: boolean; parentGroupId?: string };

function readTemplateGroups(jsonData: string | null | undefined): TemplateGroup[] {
  if (!jsonData) return [];
  try {
    const parsed = JSON.parse(jsonData) as { groups?: unknown[] };
    if (!Array.isArray(parsed.groups)) return [];
    return parsed.groups
      .filter((g): g is TemplateGroup =>
        typeof (g as Record<string, unknown>)?.id === "string" &&
        typeof (g as Record<string, unknown>)?.name === "string",
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        hidden: g.hidden,
        locked: g.locked,
        parentGroupId: typeof g.parentGroupId === "string" ? g.parentGroupId : undefined,
      }));
  } catch {
    return [];
  }
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const userContext = await getUserContext();
  if (!userContext) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Filtre optionnel par slot (ex: depuis la fiche publication via ?slotId=xxx)
  const url = new URL(req.url);
  const slotId = url.searchParams.get("slotId") ?? undefined;

  // E7 — Stall detection lazy : avant de retourner la liste, on marque FAILED
  // les packs en QUEUED/PROCESSING depuis >30 min (preparation fire-and-forget
  // peut crasher silencieusement et laisser un pack zombie). Aligné sur le
  // pattern existant pour les autres jobs (cf §16.1 / audit fiabilité).
  const STALL_THRESHOLD_MS = 30 * 60 * 1000;
  const stallCutoff = new Date(Date.now() - STALL_THRESHOLD_MS);
  await prisma.coverFramePack.updateMany({
    where: {
      status: { in: ["QUEUED", "PROCESSING"] },
      updatedAt: { lt: stallCutoff },
    },
    data: {
      status: "FAILED",
      errorMsg: "Préparation trop longue (>30 min) — pack marqué stalled automatiquement.",
    },
  });

  const packs = await prisma.coverFramePack.findMany({
    where: {
      ...(isAdmin ? {} : { userId: userContext.effectiveUser.id }),
      ...(slotId ? { render: { publicationSlotId: slotId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      candidates: { orderBy: { timestamp: "asc" } },
      render: {
        select: {
          id: true,
          status: true,
          videoUrl: true,
          createdAt: true,
          template: { select: { id: true, name: true, client: true, jsonData: true } },
          listing: { select: { user: { select: { name: true, email: true } } } },
        },
      },
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(
    packs.map((pack) => {
      // Phase 5 : render peut être null pour les packs one-off (PublicationVersion).
      const renderTemplate = pack.render?.template ?? null;
      const canvas = readTemplateCanvas(renderTemplate?.jsonData);
      const templateGroups = readTemplateGroups(renderTemplate?.jsonData);
      return {
        id: pack.id,
        status: pack.status,
        renderId: pack.renderId,
        templateId: pack.templateId,
        templateName: renderTemplate?.name ?? "Template supprimé",
        client: renderTemplate?.client ?? null,
        ownerName: isAdmin
          ? (pack.user.name
              ?? pack.user.email
              ?? pack.render?.listing?.user?.name
              ?? pack.render?.listing?.user?.email
              ?? "?")
          : null,
        frameCount: pack.frameCount,
        duration: pack.duration,
        errorMsg: pack.errorMsg,
        selectedCandidateId: pack.selectedCandidateId,
        finalCoverUrl: toBrowserMediaUrl(pack.finalCoverUrl),
        overlayOffsetX: pack.overlayOffsetX,
        overlayOffsetY: pack.overlayOffsetY,
        overlayGroupIds: safeJsonArray(pack.overlayGroupIds),
        templateGroups,
        canvasWidth: canvas.canvasWidth,
        canvasHeight: canvas.canvasHeight,
        createdAt: pack.createdAt.toISOString(),
        candidates: pack.candidates.map((candidate) => ({
          id: candidate.id,
          timestamp: candidate.timestamp,
          imageUrl: toBrowserMediaUrl(candidate.imageUrl) ?? candidate.imageUrl,
          slotId: candidate.slotId ?? null,
          sequenceIndex: candidate.sequenceIndex ?? null,
        })),
      };
    }),
  );
}
