"use client";

/**
 * AccountSummaryCard — résumé compact d'un compte Instagram.
 *
 * Utilisée dans AccountPeekDrawer pour donner en un coup d'œil l'identité,
 * le client, le volume de recettes liées, et la prochaine publication
 * programmée. Pas de CTA — les actions vivent dans le footer du drawer hôte.
 */

import { Instagram, Layers, Calendar, Clock } from "lucide-react";
import { STATUS_LABELS, ACTIVE_PIPELINE_STATUSES } from "@/lib/slots/statusLabels";
import { dateFr } from "@/lib/date/formatFr";

export interface AccountPeekData {
  id: string;
  handle: string;
  name: string;
  client: { id: string; name: string } | null;
  activeBindingsCount: number;
  totalBindingsCount: number;
  lastPublishedAt: string | null;
  nextScheduled: {
    id: string;
    scheduledAt: string;
    status: string;
    label: string | null;
  } | null;
  statsByStatus: Record<string, number>;
}

function handleInitials(handle: string): string {
  return handle.replace(/^@/, "").slice(0, 2).toUpperCase();
}

function avatarBg(handle: string): string {
  const backgrounds = [
    "bg-warning-200",
    "bg-success-200",
    "bg-info-200",
    "bg-danger-200",
    "bg-success-200",
    "bg-info-200",
  ];
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return backgrounds[h % backgrounds.length];
}

function formatDate(iso: string | null): string {
  return dateFr(iso);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AccountSummaryCard({ data }: { data: AccountPeekData }) {
  const avatarBgClass = avatarBg(data.handle);
  const inFlight = ACTIVE_PIPELINE_STATUSES.reduce(
    (acc, status) => acc + (data.statsByStatus[status] ?? 0),
    0,
  );
  const published =
    (data.statsByStatus.PUBLISHED ?? 0) + (data.statsByStatus.DONE ?? 0);

  return (
    <div className="space-y-4">
      {/* Identité */}
      <div className="flex items-center gap-3">
        <div
          className={[
            "relative h-14 w-14 rounded-full inline-flex items-center justify-center shrink-0",
            avatarBgClass,
            "",
          ].join(" ")}
        >
          <span className="text-[16px] font-semibold text-foreground tracking-tight">
            {handleInitials(data.handle)}
          </span>
          <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white inline-flex items-center justify-center ">
            <Instagram size={10} className="text-danger-600" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground truncate">
            @{data.handle}
          </p>
          <p className="text-[12px] text-muted-foreground truncate">{data.name}</p>
          {data.client ? (
            <p className="text-[10.5px] uppercase tracking-widest font-medium text-muted-foreground mt-1">
              {data.client.name}
            </p>
          ) : (
            <p className="text-[10.5px] uppercase tracking-widest font-medium text-muted-foreground mt-1 italic">
              Sans client
            </p>
          )}
        </div>
      </div>

      {/* Stats compactes */}
      <div className="grid grid-cols-2 gap-2">
        <StatBlock
          icon={Layers}
          label="Recettes actives"
          value={`${data.activeBindingsCount}/${data.totalBindingsCount}`}
        />
        <StatBlock
          icon={Calendar}
          label="Dernière publication"
          value={formatDate(data.lastPublishedAt)}
        />
        <StatBlock icon={Clock} label="En cours" value={String(inFlight)} />
        <StatBlock
          icon={Calendar}
          label="Publiées (total)"
          value={String(published)}
        />
      </div>

      {/* Prochaine publication */}
      <div className="rounded-xl bg-card border border-border p-3 ">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
          Prochaine publication
        </p>
        {data.nextScheduled ? (
          <>
            <p className="mt-1 text-[13px] font-medium text-foreground">
              {formatDateTime(data.nextScheduled.scheduledAt)}
            </p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground truncate">
              {data.nextScheduled.label ?? "Sans recette"} ·{" "}
              {STATUS_LABELS[data.nextScheduled.status as keyof typeof STATUS_LABELS] ?? data.nextScheduled.status}
            </p>
          </>
        ) : (
          <p className="mt-1 text-[12.5px] text-muted-foreground italic">
            Aucune publication programmée
          </p>
        )}
      </div>
    </div>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-2.5 ">
      <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground inline-flex items-center gap-1">
        <Icon size={10} className="text-muted-foreground" />
        {label}
      </p>
      <p className="mt-1 text-[13px] font-mono tabular-nums font-semibold text-foreground truncate">
        {value}
      </p>
    </div>
  );
}
