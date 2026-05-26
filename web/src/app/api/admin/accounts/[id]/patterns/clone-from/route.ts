/**
 * POST /api/admin/accounts/[id]/patterns/clone-from
 * Body : { sourceAccountId: string, patternIds?: string[] }
 *
 * Clone tous les patterns du compte source (ou la sous-liste patternIds)
 * vers le compte cible (id dans l'URL).
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type CloneFromBody = {
  sourceAccountId?: string;
  patternIds?: string[];
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: targetAccountId } = await params;

  // Vérifier que le compte cible existe
  const targetAccount = await prisma.instagramAccount.findUnique({
    where: { id: targetAccountId },
    select: { id: true },
  });
  if (!targetAccount) {
    return NextResponse.json({ error: "Compte cible introuvable" }, { status: 404 });
  }

  const body = await req.json() as CloneFromBody;
  const { sourceAccountId, patternIds } = body;

  if (!sourceAccountId?.trim()) {
    return NextResponse.json({ error: "Le champ sourceAccountId est requis" }, { status: 400 });
  }

  // Vérifier que le compte source existe
  const sourceAccount = await prisma.instagramAccount.findUnique({
    where: { id: sourceAccountId },
    select: { id: true },
  });
  if (!sourceAccount) {
    return NextResponse.json({ error: "Compte source introuvable" }, { status: 404 });
  }

  // Fetch les patterns source
  const where = patternIds && patternIds.length > 0
    ? { accountId: sourceAccountId, id: { in: patternIds } }
    : { accountId: sourceAccountId };

  const sourcePatterns = await prisma.accountPattern.findMany({ where });

  if (sourcePatterns.length === 0) {
    return NextResponse.json({ cloned: 0, sources: [] });
  }

  // Cloner chaque pattern vers le compte cible
  const clonedIds: string[] = [];
  for (const src of sourcePatterns) {
    // Exclure les champs non transférables (id, accountId, timestamps)
    const { id: srcId, accountId: _srcAccountId, createdAt: _srcCreatedAt, updatedAt: _srcUpdatedAt, ...rest } = src;
    void _srcAccountId; void _srcCreatedAt; void _srcUpdatedAt;
    await prisma.accountPattern.create({
      data: {
        ...rest,
        accountId: targetAccountId,
        // coverConfig est un Json nullable — on le passe tel quel
        coverConfig: rest.coverConfig !== null && rest.coverConfig !== undefined
          ? (rest.coverConfig as import("@prisma/client").Prisma.InputJsonValue)
          : undefined,
      },
    });
    clonedIds.push(srcId);
  }

  return NextResponse.json({ cloned: clonedIds.length, sources: clonedIds });
}
