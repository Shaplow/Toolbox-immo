import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { NewTemplateButton } from "@/components/templates/NewTemplateButton";
import { EditTemplateInfoButton } from "@/components/templates/EditTemplateInfoButton";
import { ImportTemplateButton } from "@/components/templates/ImportTemplateButton";
import { TemplateAdminActions } from "@/components/templates/TemplateAdminActions";
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

  const grouped = templates.reduce<Record<string, typeof templates>>((acc, template) => {
    const key = template.client?.trim() || "__none__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(template);
    return acc;
  }, {});

  const clientKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    return a.localeCompare(b, "fr");
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
            <LayoutTemplate size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Templates</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {templates.length} template{templates.length !== 1 ? "s" : ""}
              {clientKeys.filter((key) => key !== "__none__").length > 0 && (
                <> &middot; {clientKeys.filter((key) => key !== "__none__").length} client{clientKeys.filter((key) => key !== "__none__").length !== 1 ? "s" : ""}</>
              )}
            </p>
          </div>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <ImportTemplateButton />
            <NewTemplateButton />
          </div>
        ) : null}
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <LayoutTemplate size={40} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium">Aucun template pour l&apos;instant</p>
          <p className="text-sm mt-1">Créez votre premier template pour commencer</p>
        </div>
      ) : (
        <div className="space-y-10">
          {clientKeys.map((key) => (
            <section key={key}>
              {clientKeys.length > 1 && (
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    {key === "__none__" ? "Sans client" : key}
                  </h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {grouped[key].length}
                  </span>
                  <div className="flex-1 border-t border-gray-100" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {grouped[key].map((template) => {
                  const formats = JSON.parse(template.formats) as string[];
                  return (
                    <div
                      key={template.id}
                      className="bg-white border border-gray-100 rounded-xl transition-colors hover:border-gray-200 group"
                    >
                      <div className="p-4">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
                          {isAdmin && (
                            <EditTemplateInfoButton
                              id={template.id}
                              initialName={template.name}
                              initialClient={template.client}
                            />
                          )}
                        </div>
                        {clientKeys.length === 1 && template.client && (
                          <p className="text-xs text-indigo-700 mt-0.5">{template.client}</p>
                        )}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {formats.map((format) => (
                            <span
                              key={format}
                              className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                            >
                              {format}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-3">
                          {new Date(template.updatedAt).toLocaleDateString("fr-FR")}
                        </p>
                      </div>

                      <div className="px-4 pb-4">
                        <div className="flex gap-2">
                          {isAdmin && (
                            <Link
                              href={`/tools/templates/${template.id}/edit`}
                              className="flex-1 text-center text-xs bg-gray-900 text-white py-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                            >
                              Éditer
                            </Link>
                          )}
                          <Link
                            href={`/generate/${template.id}`}
                            className="flex-1 text-center text-xs bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                          >
                            Générer
                          </Link>
                          {isAdmin && <TemplateAdminActions id={template.id} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}