import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import CaptionsApp from "../../CaptionsApp";
import "../../captions.css";

type Props = {
  params: Promise<{ presetId: string }>;
};

export default async function CaptionsEditPage({ params }: Props) {
  const { presetId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/captions");

  return <CaptionsApp isAdmin={true} initialPresetId={presetId} backUrl="/captions" />;
}
