import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import CaptionsApp from "../CaptionsApp";
import "../captions.css";

export default async function CaptionsEditorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/tools/captions");

  return <CaptionsApp isAdmin={true} backUrl="/tools/captions" />;
}
