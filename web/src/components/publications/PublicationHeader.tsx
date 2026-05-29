"use client";

/**
 * PublicationHeader — header allégé de la fiche publication.
 *
 * Décision produit : la fiche complète est dédiée à la CHAÎNE DE PRODUCTION.
 * Tout ce qui touche à la gestion du slot (statut, assignations, planning,
 * override config) se gère depuis le drawer édition rapide accessible
 * depuis le calendrier. Donc le header garde uniquement :
 *
 *   - Breadcrumb minimal (retour calendrier + compte)
 *   - Titre + date
 *   - CTA "Marquer publié" (raccourci vers section Publish)
 *   - Menu actions (jobs, supprimer)
 *
 * Plus de badge statut, plus d'inline-edit MONTEUR/CM, plus de pattern badge
 * — tout ça reste dans le drawer.
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
import type { UserRole } from "@/types/roles";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { toast } from "@/components/ui/Toast";

export interface PublicationHeaderProps {
  slot: {
    id: string;
    title: string | null;
    status: string;
    scheduledAt: Date;
  };
  account: { id: string; handle: string; name: string };
  /** Listing lié — gardé dans les props pour compat appelant, non utilisé visuellement. */
  listing?: { id: string } | null;
  pattern: { id: string; label: string } | null;
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
  canMarkPublished,
  canDelete,
  currentUserRole,
}: PublicationHeaderProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const scheduledAt = new Date(slot.scheduledAt);
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
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-4">
          {/* Breadcrumb minimal */}
          <nav className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-3 flex-wrap">
            <Link
              href={currentUserRole === "ADMIN" ? "/calendar" : "/home"}
              className="inline-flex items-center gap-1 hover:text-gray-950 transition-colors"
            >
              <ArrowLeft size={11} className="flex-shrink-0" />
              {currentUserRole === "ADMIN" ? "Calendrier" : "Ma liste"}
            </Link>
            <ChevronRight size={11} className="flex-shrink-0 text-gray-300" />
            {currentUserRole === "ADMIN" ? (
              <Link
                href={`/admin/accounts/${account.id}`}
                className="text-gray-500 hover:text-gray-950 transition-colors"
                title="Voir la fiche compte"
              >
                @{account.handle}
              </Link>
            ) : (
              <span className="text-gray-500">@{account.handle}</span>
            )}
          </nav>

          {/* Titre + date + actions sur une seule rangée */}
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] font-semibold tracking-tight text-gray-950 leading-tight truncate">
                {title}
              </h1>
              <p className="mt-1 text-[12px] text-gray-500">
                {formatDateFR(scheduledAt)} · {formatTimeFR(scheduledAt)}
              </p>
            </div>

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
        </div>
      </div>
    </>
  );
}
