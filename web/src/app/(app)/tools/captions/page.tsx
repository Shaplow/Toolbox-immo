import { redirect } from "next/navigation";
import { hasTool, TOOLS } from "@/lib/permissions";
import { CaptionsGallery } from "@/components/captions/CaptionsGallery";
import { getUserContext } from "@/lib/userContext";

export default async function CaptionsPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const isAdmin = userContext.canAdminBypass;
  if (!isAdmin && !(await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS))) {
    redirect("/home");
  }

  return <CaptionsGallery isAdmin={isAdmin} />;
}
