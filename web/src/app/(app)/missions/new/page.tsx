/**
 * /missions/new — création d'une « mission ».
 *
 * Point d'entrée de l'outil `mission` (attribuable par rôle/utilisateur). Une
 * mission = génération pilotée par une recette GLOBALE (obligatoire), compte
 * Instagram OPTIONNEL. Accessible aussi depuis le calendrier et le catalogue de
 * recettes (via `?recipeId=`).
 *
 * Gate : admin réel (canAdminBypass) OU outil `mission` (hasTool).
 */
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { hasTool, TOOLS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { safeJSON } from "@/lib/utils/json";
import { PageShell } from "@/components/ui/PageShell";
import { MissionForm } from "./MissionForm";

interface PageProps {
  searchParams: Promise<{ recipeId?: string; accountId?: string; propertyId?: string }>;
}

export default async function NewMissionPage({ searchParams }: PageProps) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.MISSION))) {
    redirect("/home");
  }

  const [templates, accounts, propertyRows] = await Promise.all([
    prisma.patternTemplate.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        label: true,
        source: true,
        templateId: true,
        requiresProperty: true,
        autoSaveToLibrary: { select: { name: true } },
      },
      orderBy: { label: "asc" },
    }),
    prisma.instagramAccount.findMany({
      select: { id: true, name: true, handle: true },
      orderBy: { handle: "asc" },
    }),
    prisma.property.findMany({
      where: { isArchived: false },
      select: { id: true, label: true, fields: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const recipes = templates.map((t) => ({
    id: t.id,
    label: t.label,
    source: t.source,
    templateId: t.templateId,
    requiresProperty: t.requiresProperty,
    autoSaveLibraryName: t.autoSaveToLibrary?.name ?? null,
  }));

  const properties = propertyRows.map((p) => ({
    id: p.id,
    label: p.label,
    fields: safeJSON<Record<string, string>>(p.fields, {}),
  }));

  const { recipeId, accountId, propertyId } = await searchParams;

  return (
    <PageShell variant="narrow">
      <MissionForm
        recipes={recipes}
        accounts={accounts}
        properties={properties}
        initialRecipeId={recipeId ?? ""}
        initialAccountId={accountId ?? ""}
        initialPropertyId={propertyId ?? ""}
        canCreateRecipe={isAdmin}
      />
    </PageShell>
  );
}
