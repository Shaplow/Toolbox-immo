import { redirect } from "next/navigation";

export default async function CaptionsEditLegacyRedirect({
  params,
}: {
  params: Promise<{ presetId: string }>;
}) {
  const { presetId } = await params;
  redirect(`/captions/${presetId}/edit`);
}
