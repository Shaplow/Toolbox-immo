import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function BuilderPage({ params }: Props) {
  const { id } = await params;
  redirect(`/tools/templates/${id}/edit`);
}
