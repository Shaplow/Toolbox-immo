import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { BuilderClient } from "@/components/builder/BuilderClient";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";

type Props = { params: Promise<{ id: string }> };

export default async function BuilderPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isAdmin = session!.user!.role === "ADMIN";

  const template = await prisma.template.findFirst({
    where: isAdmin ? { id } : { id, userId },
  });
  if (!template) notFound();

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const formats = JSON.parse(template.formats) as string[];

  return (
    <BuilderClient
      templateId={template.id}
      templateName={template.name}
      templateClient={template.client}
      initialJSON={json}
      initialFormats={formats}
    />
  );
}