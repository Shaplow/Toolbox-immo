import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { hasTool, TOOLS } from "@/lib/permissions";
import CaptionsGenerateForm from "@/components/captions/CaptionsGenerateForm";

type Props = {
  params: Promise<{ presetId: string }>;
};

export default async function CaptionsGeneratePage({ params }: Props) {
  const { presetId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && !(await hasTool(session.user.id, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  let preset;
  if (isAdmin) {
    preset = await prisma.captionPreset.findUnique({ where: { id: presetId } });
  } else {
    const access = await prisma.captionPresetAccess.findFirst({
      where: { userId: session.user.id, presetId },
      include: { preset: true },
    });
    preset = access?.preset ?? null;
  }

  if (!preset) notFound();

  return (
    <CaptionsGenerateForm
      preset={{
        id: preset.id,
        name: preset.name,
        isBuiltin: preset.isBuiltin,
        config: JSON.parse(preset.config) as Record<string, unknown>,
      }}
    />
  );
}
