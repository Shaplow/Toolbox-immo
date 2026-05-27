/**
 * /validate/[token] — page publique de validation client externe.
 *
 * Cette page est accessible SANS authentification (le token EST l'auth).
 * Le rawToken est dans l'URL et n'est jamais re-stocké côté client.
 *
 * États affichés :
 * - Token valide + slot AWAITING_CLIENT → preview + actions (Valider / Refuser / Annuler)
 * - Token expiré / révoqué / inexistant → 404 générique (anti-énumération)
 * - Slot déjà répondu → message "Cette publication a déjà été [validée/annulée]"
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  verifyClientValidationToken,
  resolveClientValidationConfig,
} from "@/lib/publications/clientValidation";
import { getSlotFinalVideoUrl } from "@/lib/publications/finalVideo";
import { ValidationActions } from "./ValidationActions";

type PageProps = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Validation publication",
  // Pas d'indexation moteurs de recherche
  robots: { index: false, follow: false },
};

export default async function ValidatePage({ params }: PageProps) {
  const { token } = await params;

  const result = await verifyClientValidationToken(prisma, token);
  if (!result.valid) {
    notFound();
  }

  // Charger le slot avec ses infos affichables
  const slot = await prisma.publicationSlot.findUnique({
    where: { id: result.slotId },
    select: {
      id: true,
      status: true,
      title: true,
      caption: true,
      description: true,
      scheduledAt: true,
      needsClientValidationOverride: true,
      allowsClientRevisionOverride: true,
      account: { select: { handle: true, name: true, client: { select: { name: true } } } },
      pattern: {
        select: {
          label: true,
          needsClientValidation: true,
          allowsClientRevision: true,
        },
      },
      render: { select: { videoUrl: true, pngUrl: true } },
      captionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, outputUrl: true },
      },
      // Pour afficher l'historique des rounds si le client revient sur la page
      clientValidationRounds: {
        orderBy: { roundNumber: "desc" },
        take: 5,
        select: { roundNumber: true, action: true, comment: true, respondedAt: true },
      },
    },
  });

  if (!slot) notFound();

  // Configuration validation (override prime sur pattern)
  const config = resolveClientValidationConfig(
    {
      needsClientValidationOverride: slot.needsClientValidationOverride,
      allowsClientRevisionOverride: slot.allowsClientRevisionOverride,
    },
    slot.pattern,
  );

  // Vidéo finale (avec captions si dispo)
  const finalVideoUrl = getSlotFinalVideoUrl({
    render: slot.render,
    latestCaptionJob: slot.captionJobs[0] ?? null,
  });

  // Statut effectif du slot pour décider quoi afficher
  const isAwaiting = slot.status === "AWAITING_CLIENT";
  const isResolved = ["SCHEDULED", "PUBLISHED", "CANCELLED", "ARCHIVED"].includes(slot.status);
  const isRevision = slot.status === "CLIENT_REVISION";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Validation publication</p>
          <h1 className="text-lg font-semibold text-gray-900 mt-0.5">
            {slot.account.client?.name ?? slot.account.name} ·{" "}
            <span className="text-gray-500">@{slot.account.handle}</span>
          </h1>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* ── Preview vidéo / image ──────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {slot.pattern?.label ?? slot.title ?? "Publication"}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Publication prévue le{" "}
              {new Date(slot.scheduledAt).toLocaleString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>

            {finalVideoUrl ? (
              <video
                key={finalVideoUrl}
                controls
                playsInline
                className="w-full max-w-md mx-auto rounded-lg border border-gray-100 bg-black"
                style={{ maxHeight: 500 }}
              >
                <source src={finalVideoUrl} />
                Votre navigateur ne supporte pas la lecture vidéo.
              </video>
            ) : slot.render?.pngUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={slot.render.pngUrl}
                alt="Aperçu"
                className="w-full max-w-md mx-auto rounded-lg border border-gray-100"
              />
            ) : (
              <p className="text-sm text-gray-500 italic">
                Le contenu visuel n&apos;est pas encore disponible.
              </p>
            )}
          </section>

          {/* ── Légende Instagram ──────────────────────────────────────────── */}
          {slot.caption && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Légende Instagram
              </h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{slot.caption}</p>
            </section>
          )}

          {/* ── Description / Notes ─────────────────────────────────────────── */}
          {slot.description && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Description
              </h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{slot.description}</p>
            </section>
          )}

          {/* ── Historique des rounds (si plusieurs allers-retours) ────────── */}
          {slot.clientValidationRounds.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Historique
              </h3>
              <ul className="space-y-3">
                {slot.clientValidationRounds.map((r) => (
                  <li key={r.roundNumber} className="text-sm">
                    <span className="text-gray-500 text-xs">
                      Round {r.roundNumber} ·{" "}
                      {new Date(r.respondedAt).toLocaleString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <p className="text-gray-700 mt-0.5">
                      <span className="font-medium">
                        {r.action === "approved"
                          ? "✓ Validé"
                          : r.action === "rejected"
                            ? "✎ Modifications demandées"
                            : "✕ Annulé"}
                      </span>
                      {r.comment && <span className="text-gray-500"> · « {r.comment} »</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Actions (selon état du slot) ───────────────────────────────── */}
          {isAwaiting && (
            <ValidationActions
              token={token}
              allowsRevision={config.allowsClientRevision}
            />
          )}

          {isRevision && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="text-sm text-amber-800">
                Vous avez demandé des modifications. Le studio les traite et vous
                renverra un nouveau lien lorsque la nouvelle version sera prête.
              </p>
            </section>
          )}

          {isResolved && (
            <section className="bg-gray-50 border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-700">
                {slot.status === "SCHEDULED" && "Cette publication a été validée. Elle sera publiée à la date prévue."}
                {slot.status === "PUBLISHED" && "Cette publication est en ligne."}
                {slot.status === "CANCELLED" && "Cette publication a été annulée."}
                {slot.status === "ARCHIVED" && "Cette publication a été archivée."}
              </p>
            </section>
          )}
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-xs text-gray-400">
        Lien de validation sécurisé — ne le partagez pas.
      </footer>
    </div>
  );
}
