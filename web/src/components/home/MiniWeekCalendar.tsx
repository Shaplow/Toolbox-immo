import Link from "next/link";

/**
 * MiniWeekCalendar — mini-calendrier hebdomadaire pour les dashboards rôle.
 * Présentationnel pur : les items (events pour le vidéaste, slots pour monteur/CM)
 * sont mappés server-side vers MiniCalItem. N'utilise PAS le cockpit CalendarView.
 *
 * Rendu : 7 colonnes (lun→dim), la colonne du jour surlignée. Scroll horizontal
 * sur petit écran (les 7 colonnes ne rétrécissent pas sous 120px).
 */

export interface MiniCalItem {
  id: string;
  href: string;
  title: string;
  /** ISO string de la date/heure. */
  dateIso: string;
  /** Heure formatée (ex : « 14:00 »). */
  timeLabel: string;
  /** Classe Tailwind du dot de phase/statut (ex : « bg-primary »). */
  dotClass: string;
  subtitle?: string;
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function MiniWeekCalendar({
  items,
  weekStartIso,
}: {
  items: MiniCalItem[];
  /** Lundi de la semaine à afficher (ISO). Défaut : semaine courante. */
  weekStartIso?: string;
}) {
  const now = new Date();
  const monday = weekStartIso ? new Date(weekStartIso) : mondayOf(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const itemsByDay = days.map((day) =>
    items
      .filter((it) => sameDay(new Date(it.dateIso), day))
      .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime()),
  );

  return (
    <section className="rounded-lg bg-card border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[720px]">
          {days.map((day, i) => {
            const isToday = sameDay(day, now);
            const dayItems = itemsByDay[i];
            return (
              <div
                key={i}
                className={[
                  "min-h-[112px] border-r border-b border-border last:border-r-0 p-1.5",
                  isToday ? "bg-accent/40" : "",
                ].join(" ")}
              >
                <div className="flex items-baseline gap-1 px-1 pb-1.5">
                  <span className="text-[10.5px] font-medium text-muted-foreground uppercase tracking-wide">
                    {DAY_LABELS[i]}
                  </span>
                  <span
                    className={[
                      "text-[12px] tabular-nums",
                      isToday ? "font-semibold text-primary" : "text-foreground",
                    ].join(" ")}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayItems.map((it) => (
                    <Link
                      key={it.id}
                      href={it.href}
                      title={it.title}
                      className="flex items-center gap-1.5 rounded-md bg-muted/60 hover:bg-muted px-1.5 py-1 transition-colors focus-ring"
                    >
                      <span className={["shrink-0 w-1.5 h-1.5 rounded-full", it.dotClass].join(" ")} />
                      <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                        {it.timeLabel}
                      </span>
                      <span className="text-[11px] text-foreground truncate">{it.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
