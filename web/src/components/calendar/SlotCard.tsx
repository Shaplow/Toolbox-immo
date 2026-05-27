"use client";

import Link from "next/link";
import { STATUS_COLORS, STATUS_DOT, STATUS_LABELS, type PublicationSlot } from "@/types/calendar";

interface SlotCardProps {
  slot: PublicationSlot;
  onClick: () => void;
}

export function SlotCard({ slot, onClick }: SlotCardProps) {
  const time = new Date(slot.scheduledAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusColor = STATUS_COLORS[slot.status];
  const dot = STATUS_DOT[slot.status];

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-lg border border-gray-200 bg-white p-2.5 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      {/* Time + label (pattern.label en priorité, sinon title, sinon "Publication") */}
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xs text-gray-400 font-medium tabular-nums">{time}</span>
        <span className="text-xs font-semibold text-gray-800 truncate">
          {slot.pattern?.label ?? slot.title ?? "Publication"}
        </span>
        {slot.isAuto && (
          <span className="ml-auto shrink-0 text-[10px] text-gray-400">auto</span>
        )}
      </div>

      {/* Title (uniquement si distinct du label affiché ci-dessus) */}
      {slot.title && slot.pattern?.label && slot.title !== slot.pattern.label && (
        <p className="text-xs text-gray-600 truncate mb-1.5">{slot.title}</p>
      )}

      {/* Pattern badge cliquable — vers fiche compte */}
      {slot.pattern?.label && (
        <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
          <Link
            href={`/admin/accounts/${slot.accountId}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors"
            title={`Pattern : ${slot.pattern.label} — voir la fiche compte`}
          >
            {slot.pattern.label}
          </Link>
        </div>
      )}

      {/* Footer: status + account */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${statusColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          {STATUS_LABELS[slot.status]}
        </span>
        <span className="text-[10px] text-gray-400 truncate uppercase tracking-wide">
          {slot.account.handle}
        </span>
      </div>
    </button>
  );
}
