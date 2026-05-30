import { prisma } from "@/lib/prisma";
import { NewTemplateButton } from "@/components/templates/NewTemplateButton";
import { ImportTemplateButton } from "@/components/templates/ImportTemplateButton";
import { TemplatesGallery, type TemplateGalleryItem } from "@/components/templates/TemplatesGallery";
import { getUserContext } from "@/lib/userContext";

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
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Production
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Studio
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {items.length} template{items.length !== 1 ? "s" : ""}
                  {distinctClients.size > 0 && (
                    <>
                      {" · "}
                      <span className="tabular-nums">
                        {distinctClients.size} client{distinctClients.size !== 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ImportTemplateButton />
                  <NewTemplateButton />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inner content */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-7xl mx-auto">
            <TemplatesGallery templates={items} isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </div>
  );
}
