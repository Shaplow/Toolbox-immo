import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { RecipesPanel } from "@/components/admin/RecipesPanel";

export default async function AdminRecipesPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/tools/templates");
  }

  const recipes = await prisma.contentRecipe.findMany({
    orderBy: { code: "asc" },
    include: {
      template: { select: { name: true } },
      library: { select: { name: true } },
      defaultAssigneeMonteur: { select: { name: true } },
      defaultAssigneeCm: { select: { name: true } },
      _count: { select: { publicationSlots: true } },
    },
  });

  return (
    <div className="p-8 max-w-screen-xl mx-auto">
      <ToolPageHeader
        icon={Layers}
        iconColor="indigo"
        title="Content Recipes"
        subtitle="Visualisez et éditez les recipes de publication. Utilisez l'éditeur JSON pour modifier sans passer par Prisma Studio."
      />
      <RecipesPanel initialRecipes={recipes} />
    </div>
  );
}
