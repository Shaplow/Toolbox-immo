import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import CaptionsApp from "@/components/captions/CaptionsApp";
import "@/components/captions/captions.css";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AdminCaptionPresetEditPage({ params }: Props) {
  const { id } = await params;
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id) redirect("/login");
  if (userContext.actualUser.role !== "ADMIN") redirect("/captions");

  return <CaptionsApp isAdmin={true} initialPresetId={id} backUrl="/captions" />;
}
