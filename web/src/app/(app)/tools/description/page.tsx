import { redirect } from "next/navigation";

export default async function DescriptionLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
  }
  const qs = query.toString();
  redirect(`/descriptions${qs ? `?${qs}` : ""}`);
}
