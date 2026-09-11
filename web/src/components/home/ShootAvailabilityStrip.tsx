"use client";

/**
 * Bandeau « missions à confirmer » en tête de la worklist vidéaste.
 *
 * Jusqu'ici, répondre à une demande de disponibilité imposait d'ouvrir la fiche
 * — et rien, ni sur `/home` ni sur `/fiches`, n'indiquait qu'une réponse était
 * attendue. Le vidéaste n'avait aucun moyen de savoir qu'on lui demandait
 * quelque chose.
 *
 * Coque visuelle calquée sur `TodoStrip` (même densité, mêmes tokens) : les
 * deux se suivent en tête de page, une différence de style se lirait comme une
 * différence de nature.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { MAX_DECLINE_REASON } from "@/lib/entityAvailability";

export interface PendingShoot {
  id: string;
  label: string;
  /** Date formatée côté serveur, ou null si le tournage n'a pas encore de date. */
  dateLabel: string | null;
  isPast: boolean;
  accountHandle: string | null;
  /** Le vidéaste a déjà décliné : il peut encore se raviser. */
  declined: boolean;
}

export function ShootAvailabilityStrip({ shoots }: { shoots: PendingShoot[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<PendingShoot | null>(null);
  const [reason, setReason] = useState("");

  if (shoots.length === 0) return null;

  async function answer(id: string, value: "CONFIRMED" | "DECLINED", declineReason?: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/entities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videasteConfirmation: value,
          ...(value === "DECLINED" ? { videasteDeclineReason: declineReason ?? "" } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success(
        value === "CONFIRMED" ? "Disponibilité confirmée." : "Indisponibilité signalée.",
      );
      setDeclineFor(null);
      setReason("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className="rounded-lg bg-card border border-border overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <CalendarClock size={14} className="text-warning-700" />
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
            Missions à confirmer{" "}
            <span className="tabular-nums text-muted-foreground">· {shoots.length}</span>
          </h2>
        </header>
        <ul className="divide-y divide-border">
          {shoots.map((shoot) => (
            <li
              key={shoot.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/fiches/${shoot.id}`}
                  className="text-[13px] font-medium text-foreground truncate hover:underline focus-ring"
                >
                  {shoot.label}
                </Link>
                <p className="text-[11px] text-muted-foreground truncate">
                  {shoot.dateLabel ?? "Sans date"}
                  {shoot.accountHandle ? ` · @${shoot.accountHandle}` : ""}
                  {/* Un tournage passé jamais confirmé est le cas le plus
                      urgent : il ne doit pas se fondre dans la liste. */}
                  {shoot.isPast ? " · déjà passé" : ""}
                  {shoot.declined ? " · vous avez décliné" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={() => void answer(shoot.id, "CONFIRMED")}
                  disabled={busyId === shoot.id}
                >
                  {shoot.declined ? "Finalement disponible" : "Je suis disponible"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeclineFor(shoot);
                    setReason("");
                  }}
                  disabled={busyId === shoot.id}
                >
                  {shoot.declined ? "Modifier le motif" : "Indisponible"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={declineFor !== null}
        title="Signaler une indisponibilité ?"
        description="L'admin est prévenu. Vous pourrez revenir sur cette réponse tant que le tournage n'a pas eu lieu."
        confirmLabel="Je ne suis pas disponible"
        variant="danger"
        loading={busyId !== null}
        onConfirm={() => {
          if (declineFor) void answer(declineFor.id, "DECLINED", reason);
        }}
        onCancel={() => {
          setDeclineFor(null);
          setReason("");
        }}
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={MAX_DECLINE_REASON}
          placeholder="Motif (optionnel, visible par l'admin)…"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </ConfirmDialog>
    </>
  );
}
