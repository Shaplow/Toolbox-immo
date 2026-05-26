import { redirect } from "next/navigation";

export default async function TemplateBuilderLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/templates/${id}/edit`);
}
