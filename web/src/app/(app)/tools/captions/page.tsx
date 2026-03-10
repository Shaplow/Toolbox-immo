import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasTool, TOOLS } from "@/lib/permissions";
import { CaptionsGallery } from "@/components/captions/CaptionsGallery";

export default async function CaptionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && !(await hasTool(session.user.id, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  return <CaptionsGallery isAdmin={isAdmin} />;
}
