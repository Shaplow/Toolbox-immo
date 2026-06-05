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
      {/* Header transparent — laisse passer le pastel du wrapper.
          Style Control Center playground : eyebrow + h2 BIG + live pill. */}
      <div className="rounded-t-3xl">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-8">
          {/* Breadcrumb très discret (text-[10px] gray-400) */}
          <nav className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-3 flex-wrap">
            <Link
              href={currentUserRole === "ADMIN" ? "/calendar" : "/home"}
              className="inline-flex items-center gap-1 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={10} className="flex-shrink-0" />
              {currentUserRole === "ADMIN" ? "Calendrier" : "Ma liste"}
            </Link>
            <ChevronRight size={10} className="flex-shrink-0 text-gray-300" />
            {currentUserRole === "ADMIN" ? (
              <Link
                href={`/admin/accounts/${account.id}`}
                className="hover:text-gray-700 transition-colors"
                title="Voir la fiche compte"
              >
                @{account.handle}
              </Link>
            ) : (
              <span>@{account.handle}</span>
            )}
          </nav>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              {/* Eyebrow Control Center style */}
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Fiche publication
              </p>
              {/* Title BIG style Control Center "Production en temps réel" */}
              <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                {title}
              </h1>
              {/* Status badge — visible pour tous les rôles. Avant W4.4 le
                  statut n'était accessible qu'aux ADMIN via SlotQuickEditButton ;
                  les MONTEUR/CM/VIDEASTE devaient scroller jusqu'à la
                  ProductionChain pour le voir. */}
              <div className="mt-3 flex items-center gap-2">
                <StatusBadge domain="slot" status={slot.status} size="sm" />
                <p className="text-[13px] text-gray-500">
                  {formatDateFR(scheduledAt)} · {formatTimeFR(scheduledAt)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Live status pill glass signature ControlCenter */}
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
                <span className="text-[11px] font-mono text-gray-700 tabular-nums">
                  {formatTimeFR(scheduledAt)}
                </span>
              </div>

              {/* Édition rapide (drawer) — admin only. Ouvre le SlotDetailPanel
                  qui pilote statut, assignations, overrides en surface unique. */}
              {currentUserRole === "ADMIN" && (
                <SlotQuickEditButton slotId={slot.id} />
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
