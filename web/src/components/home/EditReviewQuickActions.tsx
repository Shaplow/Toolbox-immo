"use client";

/**
 * EditReviewQuickActions — Sprint B.
 *
 * Liste des slots en EDIT_REVIEW (versions à valider) sur HomeAdmin avec
 * boutons inline ✓ Valider / ✗ Rejeter. Évite à l'admin d'ouvrir chaque
 * fiche publication pour traiter les versions une par une.
 *
 * - ✓ Valider : POST /api/publications/[id]/versions/[versionId]/promote
 *   → promote la version + transition auto vers EDIT_APPROVED
 * - ✗ Rejeter : modal mini-commentaire → POST /api/publications/[id]/comments
 *   (si commentaire fourni, apparaît dans la timeline + activity log) puis
 *   PATCH /api/calendar/slots/[id] status=IN_EDIT pour renvoyer au monteur.
 *
 * Updates optimistes : le slot disparaît de la liste après l'action.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { shortDateFr } from "@/lib/date/formatFr";

export interface EditReviewSlotItem {
  id: string;
  title: string | null;
  patternLabel: string | null;
  accountHandle: string;
  accountName: string;
  latestVersion: { id: string; versionNumber: number; createdAt: string } | null;
}

interface Props {
  initialSlots: EditReviewSlotItem[];
}

export function EditReviewQuickActions({ initialSlots }: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<EditReviewSlotItem[]>(initialSlots);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<EditReviewSlotItem | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  async function handleApprove(slot: EditReviewSlotItem) {
    if (!slot.latestVersion) return;
    setPendingId(slot.id);
    try {
      const res = await fetch(
        `/api/publications/${slot.id}/versions/${slot.latestVersion.id}/promote`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success(`V${slot.latestVersion.versionNumber} validée`);
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPendingId(null);
    }
  }

  function openReject(slot: EditReviewSlotItem) {
    setRejecting(slot);
    setRejectComment("");
  }

  async function handleReject() {
    if (!rejecting) return;
    setRejectSaving(true);
    const trimmed = rejectComment.trim();
    try {
      // Si un commentaire est fourni, on le poste d'abord comme
      // PublicationComment (timeline + activity log COMMENT_ADDED). Évite
      // d'écraser le champ `notes` du slot et permet au monteur de voir
      // le retour dans la fiche.
      if (trimmed) {
        const commentRes = await fetch(
          `/api/publications/${rejecting.id}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: `[Rejet admin] ${trimmed}` }),
          },
        );
        if (!commentRes.ok) {
          const body = (await commentRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `Erreur ${commentRes.status}`);
        }
      }
      const res = await fetch(`/api/calendar/slots/${rejecting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_EDIT" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success("Version rejetée — retour au monteur");
      setSlots((prev) => prev.filter((s) => s.id !== rejecting.id));
      setRejecting(null);
      setRejectComment("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRejectSaving(false);
    }
  }

  if (slots.length === 0) {
    return (
      <p className="text-[12px] text-info-700/70 italic">
        Toutes les versions sont à jour.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {slots.map((slot) => {
          const uploadDate = slot.latestVersion
            ? shortDateFr(slot.latestVersion.createdAt)
            : null;
          const versionLabel = slot.latestVersion
            ? `V${slot.latestVersion.versionNumber}`
            : "Version";
          const isPending = pendingId === slot.id;
          return (
            <div
              key={slot.id}
              className="flex items-center gap-2 bg-card border border-border rounded-md pl-3 pr-2 py-2 "
            >
              <Link
                href={`/publications/${slot.id}`}
                className="flex-1 min-w-0 group"
              >
                <p className="text-[12px] font-medium text-gray-950 truncate group-hover:text-info-700 transition-colors">
                  {slot.patternLabel ?? slot.title ?? "Publication"}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  @{slot.accountHandle}
                  {slot.accountName !== slot.accountHandle && (
                    <span className="text-gray-400"> · {slot.accountName}</span>
                  )}
                </p>
              </Link>
              <div className="shrink-0 flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-info-700 bg-info-100/70 px-1.5 py-0.5 rounded">
                  {versionLabel}
                </span>
                {uploadDate && (
                  <span className="text-[10px] text-gray-400 hidden sm:block">
                    {uploadDate}
                  </span>
                )}
                <ButtonIcon
                  icon={Check}
                  label="Valider la version"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleApprove(slot)}
                  disabled={isPending || !slot.latestVersion}
                  loading={isPending}
                />
                <ButtonIcon
                  icon={X}
                  label="Rejeter la version"
                  variant="ghost"
                  size="sm"
                  onClick={() => openReject(slot)}
                  disabled={isPending}
                />
                <Link
                  href={`/publications/${slot.id}`}
                  className="text-info-600 hover:text-info-700 transition-colors"
                  aria-label="Ouvrir la fiche complète"
                >
                  <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} size="md">
          <div className="p-5">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
              Rejeter la version
            </p>
            <h3 className="mt-1 text-[18px] font-semibold text-gray-950">
              V{rejecting.latestVersion?.versionNumber ?? "?"} · @
              {rejecting.accountHandle}
            </h3>
            <p className="mt-1 text-[12px] text-gray-500">
              Le slot revient en « En montage » — le monteur saura qu&apos;il
              faut relivrer une nouvelle version.
            </p>
            <div className="mt-4">
              <FormField label="Commentaire (optionnel)">
                <Textarea
                  value={rejectComment}
                  onChange={setRejectComment}
                  rows={3}
                  placeholder="Ce qui doit être retravaillé…"
                />
              </FormField>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRejecting(null)}
                disabled={rejectSaving}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                icon={X}
                loading={rejectSaving}
                onClick={() => void handleReject()}
              >
                Rejeter
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
