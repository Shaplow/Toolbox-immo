import { redirect } from "next/navigation";

export default function AdminPromptsPage() {
  redirect("/admin/ia-config?tab=prompts");
}
