import { redirect } from "next/navigation";

export default async function TranscriptionDetailLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/transcriptions/${id}`);
}
