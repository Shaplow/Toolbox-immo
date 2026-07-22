import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { toUserRole } from "@/lib/permissions/role";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import { listEvents, toShootEventSummary } from "@/lib/services/event/eventService";
import { PageShell } from "@/components/ui/PageShell";
import { EventsCalendar } from "@/components/events/EventsCalendar";

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function EventsPage() {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) redirect("/login");

  const role = toUserRole(userContext.effectiveUser.role);
  if (role === "EXTERNAL_GENERATOR") redirect("/home");

  const isAdmin = role === "ADMIN";

  const monday = getMondayOf(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const rawEvents = await listEvents(
    { dateFrom: monday.toISOString(), dateTo: sunday.toISOString() },
    userContext,
  );

  const events = rawEvents.map(toShootEventSummary);

  // Données du modal de création — ADMIN uniquement.
  const [accounts, properties, videastes, monteurs, cms] = isAdmin
    ? await Promise.all([
        prisma.instagramAccount.findMany({
          where: { id: { notIn: [...SHARED_SENTINEL_IDS] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, handle: true },
        }),
        prisma.property.findMany({
          where: { isArchived: false },
          orderBy: { label: "asc" },
          take: 500,
          select: { id: true, label: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["VIDEASTE", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["MONTEUR", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.user.findMany({
          where: { role: { in: ["CM", "ADMIN"] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], [], [], [], []];

  return (
    <PageShell variant="default">
      <EventsCalendar
        initialEvents={events}
        initialWeekStartIso={monday.toISOString()}
        isAdmin={isAdmin}
        accounts={accounts}
        properties={properties}
        videastes={videastes.map((u) => ({ id: u.id, name: u.name }))}
        monteurs={monteurs.map((u) => ({ id: u.id, name: u.name }))}
        cms={cms.map((u) => ({ id: u.id, name: u.name }))}
      />
    </PageShell>
  );
}
