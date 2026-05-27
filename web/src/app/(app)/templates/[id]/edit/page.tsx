import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BuilderClient } from "@/components/builder/BuilderClient";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type { TemplateJSON } from "@/types/template";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: `Édition · ${template?.name ?? "Template"} | Toolbox Immo` };
}

/**
 * Décode un `?from=` en couple (url, label) safe contre les open-redirects.
 * Seules les routes internes connues sont acceptées ; sinon fallback `/templates`.
 */
function resolveBackUrl(rawFrom: string | undefined): { url: string; label: string } {
  const fallback = { url: "/templates", label: "Templates" };
  if (!rawFrom) return fallback;
  if (!rawFrom.startsWith("/") || rawFrom.startsWith("//")) return fallback;

  if (rawFrom.startsWith("/publications/")) {
    return { url: rawFrom, label: "Publication" };
  }
  if (rawFrom === "/calendar" || rawFrom.startsWith("/calendar?")) {
    return { url: rawFrom, label: "Calendrier" };
  }
  if (rawFrom === "/listings" || rawFrom.startsWith("/listings?")) {
    return { url: rawFrom, label: "Historique" };
  }
  if (rawFrom.startsWith("/templates")) {
    return { url: rawFrom, label: "Templates" };
  }
  return fallback;
}

export default async function BuilderPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from } = await searchParams;
  const session = await auth();
  const userId = session!.user!.id!;
  const isAdmin = session!.user!.role === "ADMIN";

  const template = await prisma.template.findFirst({
    where: isAdmin ? { id } : { id, userId },
  });
  if (!template) notFound();

  const json = normalizeTemplateJSON(JSON.parse(template.jsonData) as TemplateJSON);
  const formats = JSON.parse(template.formats) as string[];

  const back = resolveBackUrl(from);

  return (
    <BuilderClient
      templateId={template.id}
      templateName={template.name}
      templateClient={template.client}
      initialJSON={json}
      initialFormats={formats}
      backUrl={back.url}
      backLabel={back.label}
    />
  );
}
