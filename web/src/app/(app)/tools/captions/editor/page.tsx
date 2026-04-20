import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function CaptionsEditorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  redirect("/tools/captions");
}
