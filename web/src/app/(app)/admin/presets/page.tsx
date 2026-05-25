import { redirect } from "next/navigation";

export default function AdminPresetsPage() {
  redirect("/admin/ia-config?tab=presets");
}
