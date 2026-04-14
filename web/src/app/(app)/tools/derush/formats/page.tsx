import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DerushFormatManager } from "@/components/derush/DerushFormatManager";
import type { DerushFormat } from "@/types/derush";

export default async function DerushFormatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const formats = await prisma.derushFormat.findMany({
    where: {
      OR: [
        { isBuiltin: true },
        { userId: session.user.id },
      ],
    },
    orderBy: [
      { isBuiltin: "desc" },
      { createdAt: "asc" },
    ],
  });

  const serialized: DerushFormat[] = formats.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    description: f.description,
    contextPrompt: f.contextPrompt,
    silenceThreshold: f.silenceThreshold,
    exportMode: f.exportMode as "individual" | "qa_pair",
    isBuiltin: f.isBuiltin,
    userId: f.userId,
    createdAt: f.createdAt.toISOString(),
  }));

  return <DerushFormatManager initialFormats={serialized} isAdmin={session.user.role === "ADMIN"} />;
}
