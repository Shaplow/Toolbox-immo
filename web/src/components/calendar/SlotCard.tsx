"use client";

import Link from "next/link";
import { PipelineDots } from "./PipelineDots";
import {
  STATUS_COLORS,
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_OWNER,
  OWNER_LABEL,
  OWNER_BADGE_CLS,
  type PublicationSlot,
} from "@/types/calendar";
import type { UserRole } from "@/types/roles";

interface SlotCardProps {
  slot: PublicationSlot;
  onClick: () => void;
  /**
   * Rôle de l'utilisateur courant — utilisé pour mettre en avant les slots
   * dont l'utilisateur est responsable (bordure colorée + chip "Tu joues").
   */
  currentUserRole?: UserRole;
  /** ID de l'utilisateur courant — pour matcher avec les assignés. */
  currentUserId?: string;
}

/** Initiales courtes pour un avatar de rôle (max 2 caractères). */
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const ROLE_AVATAR_CLS: Record<"V" | "M" | "C", { bg: string; text: string; label: string }> = {
  V: { bg: "bg-amber-100", text: "text-amber-800", label: "Vidéaste" },
  M: { bg: "bg-orange-100", text: "text-orange-800", label: "Monteur" },
  C: { bg: "bg-indigo-100", text: "text-indigo-800", label: "CM" },
};

function RoleAvatar({
  role,
  name,
  highlight,
}: {
  role: "V" | "M" | "C";
  name: string | null | undefined;
  highlight?: boolean;
}) {
  const cls = ROLE_AVATAR_CLS[role];
  return (
    <span
      title={`${cls.label} : ${name ?? "non assigné"}`}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold ${cls.bg} ${cls.text} ${highlight ? "ring-2 ring-offset-1 ring-current" : ""}`}
    >
      {initials(name) || role}
    </span>
  );
}

export function SlotCard({ slot, onClick, currentUserRole, currentUserId }: SlotCardProps) {
  const time = new Date(slot.scheduledAt).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusColor = STATUS_COLORS[slot.status];
  const dot = STATUS_DOT[slot.status];
  const ownerRole = STATUS_OWNER[slot.status];

  // Détermine si le slot attend une action de l'utilisateur courant
  const isMine =
    currentUserId !== undefined &&
    ((ownerRole === "VIDEASTE" && slot.assigneeVideasteId === currentUserId) ||
      (ownerRole === "MONTEUR" && slot.assigneeMonteurId === currentUserId) ||
      (ownerRole === "CM" && slot.assigneeCmId === currentUserId) ||
      (ownerRole === "ADMIN" && currentUserRole === "ADMIN"));

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border bg-white p-2.5 hover:shadow-sm transition-all ${
        isMine
          ? "border-l-4 border-l-indigo-500 border-y border-r border-indigo-200 hover:border-indigo-400"
          : "border-gray-200 hover:border-indigo-300"
      }`}
    >
      {/* Time + label */}
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

      {/* Owner badge — qui doit jouer maintenant */}
      {ownerRole && (
        <div className="mb-1.5">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${OWNER_BADGE_CLS[ownerRole]}`}
            title={`Action attendue : ${OWNER_LABEL[ownerRole]}`}
          >
            <span className="opacity-60">→</span>
            {isMine ? "À toi" : OWNER_LABEL[ownerRole]}
          </span>
        </div>
      )}

      {/* Assignees row — visible quand au moins un est défini */}
      {(slot.assigneeVideaste || slot.assigneeMonteur || slot.assigneeCm) && (
        <div className="flex items-center gap-1 mb-1.5">
          {slot.assigneeVideaste && (
            <RoleAvatar
              role="V"
              name={slot.assigneeVideaste.name}
              highlight={ownerRole === "VIDEASTE"}
            />
          )}
          {slot.assigneeMonteur && (
            <RoleAvatar
              role="M"
              name={slot.assigneeMonteur.name}
              highlight={ownerRole === "MONTEUR"}
            />
          )}
          {slot.assigneeCm && (
            <RoleAvatar
              role="C"
              name={slot.assigneeCm.name}
              highlight={ownerRole === "CM"}
            />
          )}
        </div>
      )}

      {/* Footer: status + account + pipeline dots */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${statusColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          {STATUS_LABELS[slot.status]}
        </span>
        <span className="text-[10px] text-gray-400 truncate uppercase tracking-wide">
          {slot.account.handle}
        </span>
        <span className="ml-auto">
          <PipelineDots slot={slot} />
        </span>
      </div>
    </button>
  );
}
