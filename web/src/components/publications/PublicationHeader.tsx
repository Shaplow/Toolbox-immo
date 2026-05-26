"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  CheckCircle,
} from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/slots/statusLabels";
import type { SlotStatus, UserRole } from "@/types/roles";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";

export interface PublicationHeaderProps {
  slot: {
    id: string;
    title: string | null;
    status: string;
    scheduledAt: Date;
    contentType: string;
  };
  account: { id: string; handle: string; name: string; offre: string };
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
  const [menuOpen, setMenuOpen] = useState(false);
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

  const title = slot.title ?? "Publication sans titre";

  function handleDeleteClick() {
    setMenuOpen(false);
    setConfirmDeleteOpen(true);
  }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Erreur lors de la suppression");
      }
      router.push("/calendar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la suppression");
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  function handleMarkPublished() {
    // Scroll vers la section #publish où se trouve le formulaire de marquage.
    const section = document.getElementById("publish");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
      onConfirm={() => { void handleDeleteConfirmed(); }}
      onCancel={() => setConfirmDeleteOpen(false)}
    />
    <div className="sticky top-0 z-20 bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">
        {/* Breadcrumb + bouton retour role-aware */}
        <nav className="flex items-center gap-1 text-xs text-gray-400 mb-2 flex-wrap">
          <Link
            href={currentUserRole === "ADMIN" ? "/calendar" : "/home"}
            className="flex items-center gap-1 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft size={12} className="flex-shrink-0" />
            {currentUserRole === "ADMIN" ? "Retour au calendrier" : "Retour à ma liste"}
          </Link>
          <ChevronRight size={12} className="flex-shrink-0" />
          <span className="text-gray-500">
            {formatDateFR(scheduledAt)} à {formatTimeFR(scheduledAt)}
          </span>
          <ChevronRight size={12} className="flex-shrink-0" />
          <span className="text-gray-500 font-medium">@{account.handle}</span>
        </nav>

        {/* Titre + actions */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 leading-tight truncate">
              {title}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {currentUserRole === "ADMIN" ? (
                <Link
                  href={`/admin/accounts/${account.id}`}
                  className="hover:text-indigo-600 hover:underline transition-colors"
                  title="Voir la fiche compte"
                >
                  @{account.handle}
                </Link>
              ) : (
                <span>@{account.handle}</span>
              )}
              <span className="mx-1.5 text-gray-300">·</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${statusColor}`}
              >
                {statusLabel}
              </span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Marquer publié */}
            {canMarkPublished && slot.status !== "PUBLISHED" && (
              <button
                type="button"
                onClick={handleMarkPublished}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <CheckCircle size={14} />
                <span className="hidden sm:inline">Marquer publié</span>
              </button>
            )}

            {/* Menu ⋯ (admin only) */}
            {canDelete && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  aria-label="Actions"
                >
                  <MoreHorizontal size={16} />
                </button>

                {menuOpen && (
                  <>
                    {/* Backdrop invisible pour fermer */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-8 z-20 bg-white rounded-xl border border-gray-100 shadow-lg py-1 w-44">
                      <button
                        type="button"
                        onClick={() => handleDeleteClick()}
                        disabled={deleting}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deleting ? "Suppression…" : "Supprimer"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Badges + assignations */}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-gray-50 text-gray-600 border-gray-200">
              {slot.contentType}
            </span>
            {pattern && (
              currentUserRole === "ADMIN" ? (
                <Link
                  href={`/admin/accounts/${account.id}`}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition-colors"
                  title="Voir la fiche compte"
                >
                  {pattern.label}
                </Link>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-indigo-50 text-indigo-700 border-indigo-200">
                  {pattern.label}
                </span>
              )
            )}
          </div>

          {/* Séparateur visuel */}
          <div className="hidden sm:block h-3 w-px bg-gray-200" />

          {/* Assignations */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span>
              <span className="font-medium text-gray-600">Monteur :</span>{" "}
              {assigneeMonteur
                ? (assigneeMonteur.name ?? assigneeMonteur.email ?? assigneeMonteur.id)
                : <span className="text-gray-400 italic">Non assigné</span>}
            </span>
            <span>
              <span className="font-medium text-gray-600">CM :</span>{" "}
              {assigneeCm
                ? (assigneeCm.name ?? assigneeCm.email ?? assigneeCm.id)
                : <span className="text-gray-400 italic">Non assigné</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
