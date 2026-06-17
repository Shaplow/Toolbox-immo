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
  List,
} from "lucide-react";
import type { UserRole } from "@/types/roles";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { toast } from "@/components/ui/Toast";
import { SlotQuickEditButton } from "@/components/publications/SlotQuickEditButton";
import { StatusBadge } from "@/components/ui/molecules/StatusBadge";
import { SlotStatusTimeline } from "@/components/ui/molecules/SlotStatusTimeline";
import type { SlotStatus } from "@/types/calendar";

export interface PublicationHeaderProps {
  slot: {
    id: string;
    title: string | null;
    status: string;
    /** null = slot stocké en banque (sans date programmée). */
    scheduledAt: Date | null;
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
  canDelete,
  currentUserRole,
}: PublicationHeaderProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();


  const scheduledAt = slot.scheduledAt ? new Date(slot.scheduledAt) : null;
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
      {/* Header sticky flat (DA v3) — barre compacte ancrée en haut. */}
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          {/* Breadcrumb discret */}
          <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2 flex-wrap">
            <Link
              href={currentUserRole === "ADMIN" ? "/calendar" : "/home"}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ArrowLeft size={11} className="flex-shrink-0" />
              {currentUserRole === "ADMIN" ? "Calendrier" : "Ma liste"}
            </Link>
            <ChevronRight size={11} className="flex-shrink-0 text-muted-foreground/60" />
            {currentUserRole === "ADMIN" ? (
              <Link
                href={`/admin/accounts/${account.id}`}
                className="hover:text-foreground transition-colors"
                title="Voir la fiche compte"
              >
                @{account.handle}
              </Link>
            ) : (
              <span>@{account.handle}</span>
            )}
          </nav>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[20px] font-semibold tracking-tight text-foreground truncate">
                  {title}
                </h1>
                {/* Statut — visible pour tous les rôles. */}
                <StatusBadge domain="slot" status={slot.status} size="sm" />
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {scheduledAt ? (
                  <>
                    {formatDateFR(scheduledAt)} · {formatTimeFR(scheduledAt)}
                  </>
                ) : (
                  "En banque · non programmé"
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Édition rapide (drawer) — admin only. */}
              {currentUserRole === "ADMIN" && (
                <SlotQuickEditButton slotId={slot.id} />
              )}

              {canDelete && (
                <DropdownMenu
                  align="end"
                  trigger={
                    <ButtonIcon icon={MoreHorizontal} label="Actions" size="sm" />
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

          {/* Timeline narrative 5 étapes — vue d'ensemble compacte. */}
          <div className="mt-2">
            <SlotStatusTimeline status={slot.status as SlotStatus} size="sm" />
          </div>
        </div>
      </header>
    </>
  );
}
