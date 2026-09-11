import Link from "next/link";
import { Video, CalendarClock } from "lucide-react";
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
import { ENTITY_STATUS_DOT, type EntityStatus } from "@/types/entities";
import { validatedForTeamFilter } from "@/lib/permissions/entityScope";
import { ShootAvailabilityStrip, type PendingShoot } from "./ShootAvailabilityStrip";
import { isPastShoot, needsVideasteAnswer } from "@/lib/entityAvailability";
import { timeFr, shortDateTimeFr, longDateTimeFr } from "@/lib/date/formatFr";

interface HomeVideasteProps {
  userId: string;
  userName: string | null | undefined;
}

export async function HomeVideaste({ userId, userName }: HomeVideasteProps) {
  const weekMonday = getCurrentWeekMonday();
  const weekSunday = getCurrentWeekSunday();
  const startToday = getStartOfToday();
  const endToday = getEndOfToday();

  // Source vidéaste = ses FICHES de tournage (shoots) — plan simplification
  // Phase 5 (métaobjet), typeId="etype_tournage" (ex-ShootEvent).
  // On reste sur `assigneeVideasteId` et non la passerelle reel d'entityScope :
  // être monteur/vidéaste d'un reel du tournage donne l'accès à la fiche, pas la
  // mission de tourner — la worklist ne doit lister que ses propres tournages.
  const rawEntities = await prisma.entity.findMany({
    where: {
      typeId: "etype_tournage",
      assigneeVideasteId: userId,
      // Une commande client non tranchée par l'admin n'est pas encore une
      // mission : le tournage n'apparaît qu'une fois validé.
      ...validatedForTeamFilter(),
      status: { in: ["PLANNED", "SHOT"] },
      // Filtré en JS, pas en SQL : un tournage assigné SANS date doit quand
      // même réclamer une réponse de disponibilité (le bandeau ci-dessous le
      // couvre), même s'il n'a sa place ni dans les todos ni au calendrier.
      isArchived: false,
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      label: true,
      scheduledAt: true,
      status: true,
      isArchived: true,
      validationStatus: true,
      videasteConfirmation: true,
      account: { select: { handle: true } },
      _count: { select: { rushes: { where: { deletedAt: null } } } },
    },
  });
  // Le reste de la page (todos, calendrier, prochain tournage) raisonne sur des
  // tournages DATÉS : on restreint ici plutôt qu'en SQL, pour que le bandeau de
  // disponibilité ci-dessous puisse, lui, voir aussi les fiches sans date.
  const events = rawEntities
    .filter((e) => e.scheduledAt !== null)
    .map((e) => ({ ...e, scheduledAt: e.scheduledAt as Date }));

  // Missions dont la disponibilité n'est pas acquise. `hasPlanning: true` est
  // acquis ici (typeId = etype_tournage), le prédicat partagé fait le reste.
  const pendingShoots: PendingShoot[] = rawEntities
    .filter((e) => needsVideasteAnswer({ ...e, hasPlanning: true }))
    .map((e) => ({
      id: e.id,
      label: e.label,
      dateLabel: e.scheduledAt ? longDateTimeFr(e.scheduledAt) : null,
      isPast: isPastShoot(e.scheduledAt),
      accountHandle: e.account?.handle ?? null,
      declined: e.videasteConfirmation === "DECLINED",
    }));

  // Todo : shoots en retard (PLANNED non tourné, passé) + shoots du jour ENCORE
  // à tourner. On exclut les SHOT du bandeau « À faire » (déjà tournés) — ils
  // restent visibles dans le mini-calendrier avec leur dot « Tourné ».
  const overdue = events.filter((e) => e.status === "PLANNED" && e.scheduledAt < startToday);
  const todayShoots = events.filter(
    (e) => e.status === "PLANNED" && e.scheduledAt >= startToday && e.scheduledAt <= endToday,
  );

  const todoItems: TodoItem[] = [
    ...overdue.map((e) => ({
      id: e.id,
      href: `/fiches/${e.id}`,
      title: e.label,
      subtitle: e.account ? `@${e.account.handle}` : undefined,
      urgencyLabel: "En retard",
      tone: "danger" as const,
    })),
    ...todayShoots.map((e) => ({
      id: e.id,
      href: `/fiches/${e.id}`,
      title: e.label,
      subtitle: e.account ? `@${e.account.handle}` : undefined,
      urgencyLabel: `Aujourd'hui ${timeFr(e.scheduledAt)}`,
      tone: "default" as const,
    })),
  ];

  // Mini-calendrier : les shoots de la semaine courante.
  const weekEvents = events.filter(
    (e) => e.scheduledAt >= weekMonday && e.scheduledAt <= weekSunday,
  );
  const calItems: MiniCalItem[] = weekEvents.map((e) => ({
    id: e.id,
    href: `/fiches/${e.id}`,
    title: e.label,
    dateIso: e.scheduledAt.toISOString(),
    timeLabel: timeFr(e.scheduledAt),
    dotClass: ENTITY_STATUS_DOT[e.status as EntityStatus],
    subtitle: e.account ? `@${e.account.handle}` : undefined,
  }));

  const upcoming = events.filter((e) => e.status === "PLANNED" && e.scheduledAt > weekSunday);

  // Prochain tournage à préparer — le plus proche encore à faire, retards
  // compris. Il était jusqu'ici invisible quand il tombait « cette semaine mais
  // pas aujourd'hui » : ni dans les todos, ni dans « à venir », réduit à une
  // pastille du mini-calendrier pendant que le bandeau annonçait « tout est à
  // jour ». C'est la seule vue du vidéaste : elle doit répondre à « je tourne
  // quoi, et quand ».
  const nextShoot = events.find((e) => e.status === "PLANNED") ?? null;
  const nextIsOverdue = nextShoot ? nextShoot.scheduledAt < startToday : false;
  const nextIsToday =
    nextShoot ? nextShoot.scheduledAt >= startToday && nextShoot.scheduledAt <= endToday : false;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {events.length === 0
              ? pendingShoots.length > 0
                ? `${pendingShoots.length} mission${pendingShoots.length > 1 ? "s" : ""} à confirmer`
                : "Aucun tournage à venir."
              : `${events.length} tournage${events.length > 1 ? "s" : ""} en cours`}
          </p>
        </header>

        {/* En tête : ce qu'on ATTEND de lui passe avant ce qu'il a à faire. Une
            mission non confirmée bloque l'admin, qui ne sait pas si la date
            tient — et elle peut n'avoir aucune date, donc être absente de tout
            le reste de la page. */}
        <ShootAvailabilityStrip shoots={pendingShoots} />

        {events.length === 0 ? (
          pendingShoots.length === 0 ? (
            <EmptyState
              icon={<Video size={20} className="text-muted-foreground" />}
              title="Rien à tourner"
              description="Aucun tournage ne vous est assigné pour l'instant."
            />
          ) : null
        ) : (
          <>
            {nextShoot && (
              <section
                className={[
                  "rounded-lg border p-4",
                  nextIsOverdue
                    ? "border-danger-200 bg-danger-50"
                    : nextIsToday
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card",
                ].join(" ")}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {nextIsOverdue
                    ? "Tournage en retard"
                    : nextIsToday
                      ? "Tournage aujourd'hui"
                      : "Prochain tournage"}
                </p>
                <Link
                  href={`/fiches/${nextShoot.id}`}
                  className="mt-1 block hover:underline focus-ring rounded"
                >
                  <span className="text-[17px] font-semibold text-foreground">{nextShoot.label}</span>
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <CalendarClock size={14} />
                    {longDateTimeFr(nextShoot.scheduledAt)}
                  </span>
                  {nextShoot.account && <span>@{nextShoot.account.handle}</span>}
                  {/* Le compteur de rushs n'apparaissait que sur /fiches. */}
                  <span>
                    {nextShoot._count.rushes === 0
                      ? "Aucun rush déposé"
                      : `${nextShoot._count.rushes} rush${nextShoot._count.rushes > 1 ? "s" : ""} déposé${nextShoot._count.rushes > 1 ? "s" : ""}`}
                  </span>
                </div>
              </section>
            )}

            {/* Masqué quand il n'y a rien d'urgent mais un tournage à venir :
                « Tout est à jour » contredisait la carte juste au-dessus. */}
            {(todoItems.length > 0 || !nextShoot) && <TodoStrip items={todoItems} />}

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
                        href={`/fiches/${e.id}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-card border border-border px-4 py-2.5 hover:bg-muted transition-colors focus-ring"
                      >
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground truncate">{e.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {e.account ? `@${e.account.handle}` : "Sans compte"}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                          {shortDateTimeFr(e.scheduledAt)}
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
