"use client";

/**
 * PublicationHeader — header sticky de la fiche publication.
 *
 * UX décisions Phase 3 (migration ui-boost) :
 * - "Marquer publié" → Button primary (au lieu de CTA indigo custom).
 *   L'action ne marque pas directement : elle scroll vers la section
 *   Publish. Le tooltip natif clarifie.
 * - Menu ⋯ → DropdownMenu primitive (au lieu d'un menu artisanal avec
 *   backdrop fixed z-10 qui conflictait avec les modals).
 * - Badge pattern → Badge primitive (au lieu de pill indigo inline).
 * - Status badge garde STATUS_COLORS (palette auxiliaire, hors DS,
 *   exception documentée).
 * - Breadcrumb hover gray-950 mono (plus d'indigo).
 * - Assignations "Non assigné" sans italic (lisibilité).
 * - Density : py-3 → py-2.5, gap-3 → gap-2.5 (vibe Linear plus serré).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  CheckCircle,
  List,
} from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/slots/statusLabels";
import type { SlotStatus, UserRole } from "@/types/roles";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { toast } from "@/components/ui/Toast";
import { AssigneeInlineEdit } from "./AssigneeInlineEdit";

export interface PublicationHeaderProps {
  slot: {
    id: string;
    title: string | null;
    status: string;
    scheduledAt: Date;
  };
  account: { id: string; handle: string; name: string };
  listing: { id: string } | null;
  pattern: { id: string; label: string } | null;
  assigneeMonteur: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  assigneeCm: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  canMarkPublished: boolean;
  canDelete: boolean;
  currentUserRole: UserRole;
}

function formatDateFR(date: Date): string {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeFR(date: Date): string {
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PublicationHeader({
  slot,
  account,
  pattern,
  assigneeMonteur,
  assigneeCm,
  canMarkPublished,
  canDelete,
  currentUserRole,
}: PublicationHeaderProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const scheduledAt = new Date(slot.scheduledAt);
  const status = slot.status as SlotStatus;
  const statusLabel =
    status in STATUS_LABELS ? STATUS_LABELS[status] : slot.status;
  const statusColor =
    status in STATUS_COLORS
      ? STATUS_COLORS[status]
      : "bg-gray-100 text-gray-600 border-gray-200";

  const title = slot.title ?? pattern?.label ?? "Publication sans titre";

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de la suppression");
      }
      toast.success("Publication supprimée.");
      router.push("/calendar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la suppression");
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  function handleMarkPublished() {
    // L'action "Marquer publié" du header scrolle vers la section publish
    // (et la déplie si elle est repliée par préférence localStorage).
    // C'est intentionnel : le user fait la transition réelle dans la
    // section dédiée, pas depuis un mini bouton header.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pub:open-section", { detail: { sectionId: "publish" } }),
      );
    }
    setTimeout(() => {
      const section = document.getElementById("publish");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }

  return (
    <>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Supprimer cette publication ?"
        description="Cette action est irréversible. La publication et toutes ses données associées seront supprimées."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => {
          void handleDeleteConfirmed();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-2.5">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-[11px] text-gray-400 mb-1.5 flex-wrap">
            <Link
              href={currentUserRole === "ADMIN" ? "/calendar" : "/home"}
              className="inline-flex items-center gap-1 hover:text-gray-950 transition-colors"
            >
              <ArrowLeft size={11} className="flex-shrink-0" />
              {currentUserRole === "ADMIN" ? "Calendrier" : "Ma liste"}
            </Link>
            <ChevronRight size={11} className="flex-shrink-0 text-gray-300" />
            <span className="text-gray-500">
              {formatDateFR(scheduledAt)} à {formatTimeFR(scheduledAt)}
            </span>
            <ChevronRight size={11} className="flex-shrink-0 text-gray-300" />
            <span className="text-gray-700 font-medium">@{account.handle}</span>
          </nav>

          {/* Titre + actions */}
          <div className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-gray-950 leading-tight truncate">
                {title}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {currentUserRole === "ADMIN" ? (
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    className="text-[12px] text-gray-500 hover:text-gray-950 hover:underline transition-colors"
                    title="Voir la fiche compte"
                  >
                    @{account.handle}
                  </Link>
                ) : (
                  <span className="text-[12px] text-gray-500">@{account.handle}</span>
                )}
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] border font-medium first-letter:uppercase ${statusColor}`}
                >
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {canMarkPublished && slot.status !== "PUBLISHED" && (
                <Button
                  size="sm"
                  icon={CheckCircle}
                  onClick={handleMarkPublished}
                  title="Aller à la section Publier"
                >
                  <span className="hidden sm:inline">Marquer publié</span>
                </Button>
              )}

              {canDelete && (
                <DropdownMenu
                  align="end"
                  trigger={
                    <ButtonIcon
                      icon={MoreHorizontal}
                      label="Actions"
                      size="sm"
                    />
                  }
                  items={[
                    {
                      label: "Voir tous les jobs",
                      icon: List,
                      onClick: () => router.push(`/listings?slotId=${slot.id}`),
                    },
                    "separator",
                    {
                      label: "Supprimer",
                      icon: Trash2,
                      destructive: true,
                      onClick: () => setConfirmDeleteOpen(true),
                    },
                  ]}
                />
              )}
            </div>
          </div>

          {/* Badges + assignations */}
          <div className="flex flex-wrap items-center gap-3 mt-2.5">
            {pattern && (
              <div className="flex flex-wrap gap-1.5">
                {currentUserRole === "ADMIN" ? (
                  <Link
                    href={`/admin/accounts/${account.id}`}
                    title="Voir la fiche compte"
                    className="focus-ring rounded-md"
                  >
                    <Badge>{pattern.label}</Badge>
                  </Link>
                ) : (
                  <Badge>{pattern.label}</Badge>
                )}
              </div>
            )}

            {pattern && (
              <div className="hidden sm:block h-3 w-px bg-gray-200" />
            )}

            <div className="flex flex-wrap gap-3 text-[12px] text-gray-600">
              <span className="inline-flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">
                  Monteur
                </span>
                {currentUserRole === "ADMIN" ? (
                  <AssigneeInlineEdit slotId={slot.id} role="MONTEUR" current={assigneeMonteur} />
                ) : assigneeMonteur ? (
                  <span className="text-gray-950">
                    {assigneeMonteur.name ?? assigneeMonteur.email ?? assigneeMonteur.id}
                  </span>
                ) : (
                  <span className="text-gray-400">non assigné</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">
                  CM
                </span>
                {currentUserRole === "ADMIN" ? (
                  <AssigneeInlineEdit slotId={slot.id} role="CM" current={assigneeCm} />
                ) : assigneeCm ? (
                  <span className="text-gray-950">
                    {assigneeCm.name ?? assigneeCm.email ?? assigneeCm.id}
                  </span>
                ) : (
                  <span className="text-gray-400">non assigné</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
