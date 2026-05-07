import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { CalendarView } from "@/components/calendar/CalendarView";

export default async function CalendarPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const accounts = await prisma.instagramAccount.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true, offre: true },
  });

  return (
    <div className="flex flex-col h-full">
      <CalendarView accounts={accounts} />
    </div>
  );
}
