"use client";

import Link from "next/link";
import { PipelineDots } from "./PipelineDots";
import {
  OWNER_LABEL,
  OWNER_BADGE_CLS,
  type PublicationSlot,
} from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";
import { getPublicationPhase, PHASE_LABELS, PHASE_COLORS, PHASE_DOT } from "@/lib/slots/phase";
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
  // Phase 2.2 : on n'affiche plus le statut DB (17 valeurs verbeuses) mais une
  // phase humaine (5 valeurs). La granularité technique (render, cover,
  // captions, description, publish) est portée par PipelineDots avec les
  // vraies données des jobs — pas par le badge.
  const phase = getPublicationPhase(slot.status);
  const phaseColor = PHASE_COLORS[phase];
  const phaseDot = PHASE_DOT[phase];
  // Owner contextualisé : PLANNED/TO_DO avec vidéaste assigné devient
  // VIDEASTE (sinon STATUS_OWNER renvoie ADMIN, faussant le badge).
  const ownerRole = resolveSlotOwner(slot);

  // Détermine si le slot attend une action de l'utilisateur courant
  const isMine =
    currentUserId !== undefined &&
    ((ownerRole === "VIDEASTE" && slot.assigneeVideasteId === currentUserId) ||
      (ownerRole === "MONTEUR" && slot.assigneeMonteurId === currentUserId) ||
      (ownerRole === "CM" && slot.assigneeCmId === currentUserId) ||
      (ownerRole === "ADMIN" && currentUserRole === "ADMIN"));

  // Wrapper en <div role="button"> au lieu de <button> : la card peut
  // contenir un <Link> (badge pattern) qui était HTML invalide imbriqué
  // dans un <button>, produisant un targeting erratique au clic.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`group w-full text-left rounded-xl border bg-white p-3 cursor-pointer hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 transition-all ${
        isMine
          ? "border-l-4 border-l-indigo-500 border-y border-r border-indigo-200 hover:border-indigo-400"
          : "border-gray-200 hover:border-indigo-300"
      }`}
    >
      {/* Ligne 1 — heure + titre + flag auto */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs text-gray-500 font-medium tabular-nums shrink-0">{time}</span>
        <span className="text-sm font-semibold text-gray-900 truncate flex-1">
          {slot.pattern?.label ?? slot.title ?? "Publication"}
        </span>
        {slot.isAuto && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">auto</span>
        )}
      </div>

      {/* Sous-titre — visible uniquement si distinct du label */}
      {slot.title && slot.pattern?.label && slot.title !== slot.pattern.label && (
        <p className="text-xs text-gray-500 truncate mb-2">{slot.title}</p>
      )}

      {/* Ligne 2 — owner badge + handle compte */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {ownerRole && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${OWNER_BADGE_CLS[ownerRole]}`}
            title={`Action attendue : ${OWNER_LABEL[ownerRole]}`}
          >
            {isMine ? "À toi" : OWNER_LABEL[ownerRole]}
          </span>
        )}
        <span className="text-[11px] text-gray-500 truncate">
          @{slot.account.handle}
        </span>
      </div>

      {/* Ligne 3 — avatars assignés (si au moins un défini) */}
      {(slot.assigneeVideaste || slot.assigneeMonteur || slot.assigneeCm) && (
        <div className="flex items-center gap-1.5 mb-2">
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

      {/* Footer — phase + pattern + pipeline dots */}
      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${phaseColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${phaseDot}`} />
          {PHASE_LABELS[phase]}
        </span>
        {slot.pattern?.label && (
          <Link
            href={
              slot.patternId
                ? `/admin/accounts/${slot.accountId}?pattern=${slot.patternId}`
                : `/admin/accounts/${slot.accountId}`
            }
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors"
            title={`Pattern : ${slot.pattern.label} — voir le détail`}
          >
            {slot.pattern.label}
          </Link>
        )}
        <span className="ml-auto">
          <PipelineDots slot={slot} />
        </span>
      </div>
    </div>
  );
}
