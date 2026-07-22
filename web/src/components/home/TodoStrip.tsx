import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * TodoStrip — bandeau « à faire aujourd'hui / en retard » en tête des dashboards
 * rôle. Présentationnel pur : les items sont mappés server-side depuis les
 * events (vidéaste) ou les slots (monteur/CM). Réutilise isSlotOverdue + isDueToday
 * côté serveur pour construire la liste.
 */

export interface TodoItem {
  id: string;
  href: string;
  title: string;
  /** Ligne secondaire (compte, heure…). */
  subtitle?: string;
  /** Libellé d'urgence court, ex : « En retard », « Aujourd'hui 14:00 ». */
  urgencyLabel: string;
  tone: "danger" | "default";
}

export function TodoStrip({ items }: { items: TodoItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-card border border-border px-4 py-3">
        <CheckCircle2 size={16} className="text-success-600 shrink-0" />
        <p className="text-[13px] text-muted-foreground">
          Rien d&apos;urgent aujourd&apos;hui. Tout est à jour.
        </p>
      </div>
    );
  }

  const overdueCount = items.filter((i) => i.tone === "danger").length;

  return (
    <section className="rounded-lg bg-card border border-border overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <AlertTriangle size={14} className={overdueCount > 0 ? "text-danger-600" : "text-muted-foreground"} />
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
          À faire {items.length > 0 && <span className="tabular-nums text-muted-foreground">· {items.length}</span>}
        </h2>
        {overdueCount > 0 && (
          <span className="ml-auto text-[11px] text-danger-700 tabular-nums">
            {overdueCount} en retard
          </span>
        )}
      </header>
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted transition-colors focus-ring"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">{item.title}</p>
                {item.subtitle && (
                  <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>
                )}
              </div>
              <span
                className={[
                  "shrink-0 text-[11px] tabular-nums rounded-md px-1.5 py-0.5 border",
                  item.tone === "danger"
                    ? "bg-danger-50 text-danger-700 border-danger-200"
                    : "bg-muted text-muted-foreground border-border",
                ].join(" ")}
              >
                {item.urgencyLabel}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
