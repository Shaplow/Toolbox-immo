import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
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
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  if (role === "USER") redirect("/home");

  const userId = userContext.effectiveUser.id;

  // ADMIN voit tous les comptes ; MONTEUR/CM voient uniquement les comptes
  // sur lesquels ils ont des slots assignés (alignement avec whereClauseForUser).
  const accounts = await prisma.instagramAccount.findMany({
    where:
      role === "ADMIN"
        ? undefined
        : {
            publicationSlots: {
              some:
                role === "MONTEUR"
                  ? { assigneeMonteurId: userId }
                  : { assigneeCmId: userId },
            },
          },
    orderBy: { name: "asc" },
    select: { id: true, name: true, handle: true },
  });

  // Pass the server-computed Monday so client and server agree on the initial week,
  // preventing React hydration mismatches caused by timezone differences.
  const initialWeekStart = getMondayISOOf(new Date());

  return (
    <div className="flex flex-col h-full">
      <CalendarView
        accounts={accounts}
        initialWeekStart={initialWeekStart}
        currentUserRole={role}
      />
    </div>
  );
}
