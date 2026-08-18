"use client";

/**
 * InboxItem — un item de l'AdminInbox.
 *
 * Affichage générique pour les 7 typologies (version_review, overdue,
 * no_monteur, no_videaste, no_pattern, rushes_overdue, bank_ready), avec
 * actions inline contextuelles.
 *
 * Pattern :
 *  - Lien principal (titre + meta) → /publications/[id] (fiche complète)
 *  - 1-2 boutons inline à droite selon typology
 *  - Toast feedback + router.refresh via useInlineAction
 */

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  ArrowRight,
  CalendarClock,
  AlertCircle,
  User as UserIcon,
  Video,
  FileQuestion,
  PackageOpen,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { useInlineAction } from "@/hooks/useInlineAction";
import { shortDateFr } from "@/lib/date/formatFr";
import type { InboxItem as InboxItemData, InboxTypology } from "@/lib/services/inbox/getInboxItems";

const TYPOLOGY_META: Record<
  InboxTypology,
  { label: string; icon: LucideIcon; tone: "rose" | "peach" | "sky" | "sage" }
> = {
  version_review: { label: "À valider", icon: Check, tone: "sky" },
  overdue: { label: "En retard", icon: AlertCircle, tone: "rose" },
  no_monteur: { label: "Sans monteur", icon: UserIcon, tone: "peach" },
  no_videaste: { label: "Sans vidéaste", icon: Video, tone: "peach" },
  rushes_overdue: { label: "Rushes en retard", icon: AlertCircle, tone: "rose" },
  no_pattern: { label: "Sans recette", icon: FileQuestion, tone: "peach" },
  bank_ready: { label: "Banque prête", icon: PackageOpen, tone: "sage" },
};

const TONE_CHIP: Record<"rose" | "peach" | "sky" | "sage", string> = {
  rose: "bg-danger-100/70 text-danger-700",
  peach: "bg-warning-100/70 text-warning-700",
  sky: "bg-info-100/70 text-info-700",
  sage: "bg-success-100/70 text-success-700",
};

interface Props {
  item: InboxItemData;
}

export function InboxItem({ item }: Props) {
  const router = useRouter();
  const { trigger, pending } = useInlineAction();
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  const meta = TYPOLOGY_META[item.typology];
  const Icon = meta.icon;

  // ── Actions ─────────────────────────────────────────────────────────
  function handleApprove() {
    if (!item.latestVersion) return;
    void trigger({
      url: `/api/publications/${item.slot.id}/versions/${item.latestVersion.id}/promote`,
      successMessage: `V${item.latestVersion.versionNumber} validée`,
    });
  }

  function handleShiftTomorrow() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    void trigger({
      url: `/api/calendar/slots/${item.slot.id}`,
      method: "PATCH",
      body: { scheduledAt: tomorrow.toISOString() },
      successMessage: "Décalé à demain",
    });
  }

  async function handleRejectConfirm() {
    setRejectSaving(true);
    try {
      const trimmed = rejectComment.trim();
      if (trimmed) {
        const cRes = await fetch(
          `/api/publications/${item.slot.id}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: `[Rejet admin] ${trimmed}` }),
          },
        );
        if (!cRes.ok) {
          const body = (await cRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${cRes.status}`);
        }
      }
      const sRes = await fetch(`/api/calendar/slots/${item.slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_EDIT" }),
      });
      if (!sRes.ok) {
        const body = (await sRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${sRes.status}`);
      }
      setRejecting(false);
      setRejectComment("");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      // toast via inline action would refresh — here on error reuse toast via window
      // Use the simpler approach via toast import.
      (await import("@/components/ui/Toast")).toast.error(msg);
    } finally {
      setRejectSaving(false);
    }
  }

  // ── Meta dynamique selon typology ───────────────────────────────────
  const sublabel = (() => {
    if (item.typology === "version_review" && item.latestVersion) {
      const created = shortDateFr(item.latestVersion.createdAt);
      return `V${item.latestVersion.versionNumber} · ${created}`;
    }
    if (item.typology === "overdue" || item.typology === "rushes_overdue") {
      if (item.slot.scheduledAt) {
        const days = Math.floor(
          (Date.now() - new Date(item.slot.scheduledAt).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        return days === 0 ? "Aujourd'hui" : `Il y a ${days}j`;
      }
    }
    if (item.typology === "bank_ready") {
      return "Prête à programmer";
    }
    return null;
  })();

  return (
    <>
      <div className="flex items-center gap-2 bg-card border border-border rounded-md pl-3 pr-2 py-2  hover:bg-muted transition-colors">
        {/* Typology chip */}
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${TONE_CHIP[meta.tone]}`}
          title={meta.label}
        >
          <Icon size={10} />
          <span className="hidden sm:inline">{meta.label}</span>
        </span>

        {/* Body */}
        <Link
          href={`/publications/${item.slot.id}`}
          className="flex-1 min-w-0 group"
        >
          <p className="text-[12px] font-medium text-gray-950 truncate group-hover:text-info-700 transition-colors">
            {item.slot.patternLabel ?? item.slot.title ?? "Publication"}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            @{item.slot.accountHandle}
            {item.slot.accountName !== item.slot.accountHandle && (
              <span className="text-gray-400"> · {item.slot.accountName}</span>
            )}
            {sublabel && (
              <span className="text-gray-400"> · {sublabel}</span>
            )}
          </p>
        </Link>

        {/* Actions inline */}
        <div className="shrink-0 inline-flex items-center gap-1.5">
          {item.typology === "version_review" && item.latestVersion && (
            <>
              <ButtonIcon
                icon={Check}
                label="Valider la version"
                variant="ghost"
                size="sm"
                onClick={handleApprove}
                disabled={pending}
                loading={pending}
              />
              <ButtonIcon
                icon={X}
                label="Rejeter la version"
                variant="ghost"
                size="sm"
                onClick={() => setRejecting(true)}
                disabled={pending}
              />
            </>
          )}
          {item.typology === "overdue" && (
            <ButtonIcon
              icon={CalendarClock}
              label="Décaler à demain"
              variant="ghost"
              size="sm"
              onClick={handleShiftTomorrow}
              disabled={pending}
              loading={pending}
            />
          )}
          {item.typology === "bank_ready" && (
            <Link
              href={`/publications/${item.slot.id}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-success-700 hover:bg-success-100/70 transition-colors"
              title="Programmer"
            >
              <Sparkles size={11} />
              <span className="hidden sm:inline">Programmer</span>
            </Link>
          )}
          <Link
            href={`/publications/${item.slot.id}`}
            className="text-info-600 hover:text-info-700 transition-colors"
            aria-label="Ouvrir la fiche complète"
          >
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {/* Modal de rejet */}
      {rejecting && (
        <Modal open onClose={() => setRejecting(false)} size="md">
          <div className="p-5">
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
              Rejeter la version
            </p>
            <h3 className="mt-1 text-[18px] font-semibold text-gray-950">
              V{item.latestVersion?.versionNumber ?? "?"} · @
              {item.slot.accountHandle}
            </h3>
            <p className="mt-1 text-[12px] text-gray-500">
              La publication revient en « En montage » — le monteur saura
              qu&apos;il faut relivrer une nouvelle version.
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
                onClick={() => setRejecting(false)}
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
                onClick={() => void handleRejectConfirm()}
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
