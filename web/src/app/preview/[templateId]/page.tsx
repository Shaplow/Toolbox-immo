import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildHTML } from "@/lib/renderer/buildHTML";
import { buildSchemaPreviewData } from "@/lib/schemaFields";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import { TemplatePreviewFrame } from "@/components/templates/TemplatePreviewFrame";
import type { TemplateJSON } from "@/types/template";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

type Props = {
  params: Promise<{ templateId: string }>;
  searchParams?: Promise<{ debug?: string }>;
};

export default async function TemplatePreviewPage({ params, searchParams }: Props) {
  const { templateId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const layoutDebug = resolvedSearchParams?.debug === "layout";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      name: true,
      client: true,
      userId: true,
      jsonData: true,
    },
  });

  if (!template) notFound();

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && template.userId !== session.user.id) {
    const access = await prisma.templateAccess.findUnique({
      where: {
        userId_templateId: {
          userId: session.user.id,
          templateId,
        },
      },
    });
    if (!access) notFound();
  }

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const html = await buildHTML(json, buildSchemaPreviewData(json.schema), { layoutDebug });
  const title = template.client ? `${template.name} · ${template.client}` : template.name;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-neutral-950 text-white">
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-black/30">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-white/45">{layoutDebug ? "Debug layout" : "Aperçu du template"}</p>
          <h1 className="text-sm font-medium truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/templates"
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-white/60 hover:bg-white/10 transition-colors"
          >
            ← Galerie templates
          </Link>
          <a
            href={`/templates/${templateId}/edit`}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-white/80 hover:bg-white/10 transition-colors"
          >
            Retour à l&apos;éditeur
          </a>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-neutral-950 p-3 md:p-4">
        <TemplatePreviewFrame
          html={html}
          title={title}
          width={json.canvas.width}
          height={json.canvas.height}
          templateId={templateId}
          layoutDebug={layoutDebug}
        />
      </div>
    </div>
  );
}
