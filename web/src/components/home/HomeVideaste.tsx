import Link from "next/link";
import { Video } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { TodoStrip, type TodoItem } from "./TodoStrip";
import { MiniWeekCalendar, type MiniCalItem } from "./MiniWeekCalendar";
import {
  getCurrentWeekMonday,
  getCurrentWeekSunday,
  getStartOfToday,
  getEndOfToday,
} from "@/types/worklist";
import { EVENT_STATUS_DOT, type ShootEventStatus } from "@/types/events";

interface HomeVideasteProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeVideaste({ userId, userName }: HomeVideasteProps) {
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();
  const startToday = getStartOfToday();
  const endToday = getEndOfToday();

  // Source vidéaste = ses ÉVÉNEMENTS de tournage (shoots).
  const events = await prisma.shootEvent.findMany({
    where: {
      assigneeVideasteId: userId,
      status: { in: ["PLANNED", "SHOT"] },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      status: true,
      account: { select: { handle: true } },
      _count: { select: { rushes: { where: { deletedAt: null } } } },
    },
  });

  const timeLabel = (d: Date) =>
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  // Todo : shoots en retard (PLANNED non tourné, passé) + shoots du jour.
  const overdue = events.filter((e) => e.status === "PLANNED" && e.scheduledAt < startToday);
  const todayShoots = events.filter(
    (e) => e.scheduledAt >= startToday && e.scheduledAt <= endToday,
  );

  const todoItems: TodoItem[] = [
    ...overdue.map((e) => ({
      id: e.id,
      href: `/events/${e.id}`,
      title: e.title,
      subtitle: e.account ? `@${e.account.handle}` : undefined,
      urgencyLabel: "En retard",
      tone: "danger" as const,
    })),
    ...todayShoots.map((e) => ({
      id: e.id,
      href: `/events/${e.id}`,
      title: e.title,
      subtitle: e.account ? `@${e.account.handle}` : undefined,
      urgencyLabel: `Aujourd'hui ${timeLabel(e.scheduledAt)}`,
      tone: "default" as const,
    })),
  ];

  // Mini-calendrier : les shoots de la semaine courante.
  const weekEvents = events.filter(
    (e) => e.scheduledAt >= weekMonday && e.scheduledAt <= weekSunday,
  );
  const calItems: MiniCalItem[] = weekEvents.map((e) => ({
    id: e.id,
    href: `/events/${e.id}`,
    title: e.title,
    dateIso: e.scheduledAt.toISOString(),
    timeLabel: timeLabel(e.scheduledAt),
    dotClass: EVENT_STATUS_DOT[e.status as ShootEventStatus],
    subtitle: e.account ? `@${e.account.handle}` : undefined,
  }));

  const upcoming = events.filter((e) => e.status === "PLANNED" && e.scheduledAt > weekSunday);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {events.length === 0
              ? "Aucun tournage à venir."
              : `${events.length} tournage${events.length > 1 ? "s" : ""} en cours`}
          </p>
        </header>

        {events.length === 0 ? (
          <EmptyState
            icon={<Video size={20} className="text-muted-foreground" />}
            title="Rien à tourner"
            description="Aucun événement de tournage ne vous est assigné pour l'instant."
          />
        ) : (
          <>
            <TodoStrip items={todoItems} />

            <div>
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground mb-2">
                Ma semaine
              </h2>
              <MiniWeekCalendar items={calItems} weekStartIso={weekMonday.toISOString()} />
            </div>

            {upcoming.length > 0 && (
              <section>
                <h3 className="text-[13px] font-semibold tracking-tight text-foreground mb-2">
                  Tournages à venir
                </h3>
                <ul className="space-y-2">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/events/${e.id}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-card border border-border px-4 py-2.5 hover:bg-muted transition-colors focus-ring"
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground truncate">{e.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {e.account ? `@${e.account.handle}` : "Sans compte"}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {e.scheduledAt.toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
