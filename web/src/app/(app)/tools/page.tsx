import { hasTool, TOOLS } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { getUserContext, parsePermissions } from "@/lib/userContext";

export default async function ToolsPage() {
  const userContext = await getUserContext();
  if (!userContext) redirect("/login");

  const userPerms = parsePermissions(userContext.effectiveUser.permissions);

  const hasTemplates =
    userPerms.includes("templates") ||
    userPerms.includes("templates:view") ||
    userPerms.includes("templates:generate") ||
    userPerms.includes("templates:edit") ||
    userPerms.includes("templates:manage");

  if (userContext.canAdminBypass) {
    redirect("/tools/templates");
  }

  if (hasTemplates) {
    redirect("/tools/templates");
  }

  if (await hasTool(userContext.effectiveUser.id, TOOLS.CAPTIONS)) {
    redirect("/tools/captions");
  }

  redirect("/home");
}