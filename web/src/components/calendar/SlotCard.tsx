"use client";

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
      {/* Time + type */}
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xs text-gray-400 font-medium tabular-nums">{time}</span>
        <span className="text-xs font-semibold text-gray-800 truncate">{slot.contentType}</span>
        {slot.isAuto && (
          <span className="ml-auto shrink-0 text-[10px] text-gray-400">auto</span>
        )}
      </div>

      {/* Title */}
      {slot.title && (
        <p className="text-xs text-gray-600 truncate mb-1.5">{slot.title}</p>
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
