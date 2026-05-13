import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { CalendarView } from "@/components/calendar/CalendarView";

/** Returns the ISO string of Monday for the week containing `date` (server-side). */
function getMondayISOOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function CalendarPage() {
  const userContext = await getUserContext();
  if (!userContext?.actualUser.id || userContext.actualUser.role !== "ADMIN") {
    redirect("/home");
  }

  const accounts = await prisma.instagramAccount.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true, offre: true },
  });

  // Pass the server-computed Monday so client and server agree on the initial week,
  // preventing React hydration mismatches caused by timezone differences.
  const initialWeekStart = getMondayISOOf(new Date());

  return (
    <div className="flex flex-col h-full">
      <CalendarView accounts={accounts} initialWeekStart={initialWeekStart} />
    </div>
  );
}
