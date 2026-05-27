import { redirect } from "next/navigation";

export default async function CaptionsGenerateLegacyRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ presetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { presetId } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
  }
  const qs = query.toString();
  redirect(`/captions/${presetId}/generate${qs ? `?${qs}` : ""}`);
}
