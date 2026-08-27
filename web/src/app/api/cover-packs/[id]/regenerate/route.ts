import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api/requireAuth";
import { deleteCoverPackAssets, queueCoverFramePackPreparation } from "@/lib/coverAuto";
import { hasTool, TOOLS } from "@/lib/permissions";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (auth.response) return auth.response;
  const userContext = auth.ctx;

  const isAdmin = userContext.canAdminBypass;
  const effectiveUserId = userContext.effectiveUser.id;
  if (!isAdmin && !(await hasTool(effectiveUserId, TOOLS.COVERS))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;
  // Charge la chaîne pack → render → publicationSlot pour que CM/MONTEUR
  // assignés au slot puissent régénérer un pack créé par le system/admin
  // (auto-template). Sans ça, le pack auto reste verrouillé sur son owner.
  const pack = await prisma.coverFramePack.findUnique({
    where: { id },
    include: {
      render: {
        select: {
          publicationSlot: {
            select: {
              assigneeMonteurId: true,
              assigneeCmId: true,
              assigneeVideasteId: true,
            },
          },
        },
      },
    },
  });
  if (!pack) return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });

  if (!isAdmin) {
    const isOwner = pack.userId === effectiveUserId;
    const slot = pack.render?.publicationSlot ?? null;
    const role = toUserRole(userContext.effectiveUser.role);
    const isAssignedToSlot = !!slot && canUserAccessSlot(slot, role, effectiveUserId);
    if (!isOwner && !isAssignedToSlot) {
      return NextResponse.json({ error: "Pack introuvable" }, { status: 404 });
    }
  }

  // Purge le préfixe entier : les candidats, ceux dont la ligne DB manque, et le
  // final.png que ce reset orpheline (finalCoverKey est remis à null juste après).
  await deleteCoverPackAssets(id);
  await prisma.coverFrameCandidate.deleteMany({ where: { packId: id } });
  await prisma.coverFramePack.update({
    where: { id },
    data: {
      status: "QUEUED",
      // L'incrément vit ICI, dans la route qui remet le pack à zéro — pas dans la
      // préparation. Un webhook RunPod en retard doit être périmé dès l'instant du
      // clic : s'il ne l'était qu'une fois le nouveau plan calculé, il aurait le
      // temps de créer des candidats pointant sur des objets R2 déjà purgés.
      extractAttempt: { increment: 1 },
      runpodJobId: null,
      selectedCandidateId: null,
      finalCoverUrl: null,
      finalCoverKey: null,
      errorMsg: null,
    },
  });

  queueCoverFramePackPreparation(id);
  return NextResponse.json({ ok: true, status: "QUEUED", candidates: [] }, { status: 202 });
}
