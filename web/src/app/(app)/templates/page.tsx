import { prisma } from "@/lib/prisma";
import { LayoutTemplate } from "lucide-react";
import { NewTemplateButton } from "@/components/templates/NewTemplateButton";
import { ImportTemplateButton } from "@/components/templates/ImportTemplateButton";
import { TemplatesGallery, type TemplateGalleryItem } from "@/components/templates/TemplatesGallery";
import { getUserContext } from "@/lib/userContext";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

export default async function TemplatesPage() {
  const userContext = await getUserContext();
  const userId = userContext!.effectiveUser.id;
  const isAdmin = userContext!.canAdminBypass;

  let templates;
  if (isAdmin) {
    templates = await prisma.template.findMany({
      orderBy: [{ client: "asc" }, { name: "asc" }],
    });
  } else {
    const accesses = await prisma.templateAccess.findMany({
      where: { userId },
      include: { template: true },
      orderBy: { createdAt: "desc" },
    });
    templates = accesses.map((a) => a.template);
  }

  const items: TemplateGalleryItem[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    client: t.client,
    formats: JSON.parse(t.formats) as string[],
    updatedAt: t.updatedAt.toISOString(),
  }));

  const distinctClients = new Set(
    items.map((t) => t.client?.trim()).filter((c): c is string => Boolean(c)),
  );

  return (
    <div className="p-8">
      <ToolPageHeader
        icon={LayoutTemplate}
        iconColor="indigo"
        title="Templates"
        subtitle={
          <>
            {items.length} template{items.length !== 1 ? "s" : ""}
            {distinctClients.size > 0 && (
              <>
                {" "}
                &middot; {distinctClients.size} client{distinctClients.size !== 1 ? "s" : ""}
              </>
            )}
          </>
        }
        actions={isAdmin ? <><ImportTemplateButton /><NewTemplateButton /></> : undefined}
      />

      <TemplatesGallery templates={items} isAdmin={isAdmin} />
    </div>
  );
}
