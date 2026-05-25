import { redirect } from "next/navigation";

export default function AdminOffersPage() {
  redirect("/admin/offer-schedule?tab=offers");
}
