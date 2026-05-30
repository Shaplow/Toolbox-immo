"use client";

/**
 * ClientValidationSection — section "Validation client" de la fiche publication.
 *
 * Affichage selon le statut du slot et le rôle :
 *  - Section MASQUÉE si needsClientValidation = false (résolu)
 *  - ADMIN : peut générer / renouveler / révoquer le magic link + escape hatch
 *    (marquer validé/annulé manuellement)
 *  - CM/MONTEUR : voit le statut + historique mais n'agit pas (config par admin)
 *
 * Le rawToken n'est jamais fetch — il n'apparaît qu'en mémoire JS au moment où
 * l'admin clique "Générer un lien". Refresh de la page = il faut régénérer.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Copy, Check, CheckCircle, XCircle, RefreshCw, X, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/molecules/Section";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import type { UserRole } from "@/types/roles";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ActiveToken {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: { id: string; name: string | null; email: string | null } | null;
}

interface ClientValidationRound {
  roundNumber: number;
  action: string;
  comment: string | null;
  respondedAt: string;
}

interface Props {
  slotId: string;
  slotStatus: string;
  /** Config résolue (pattern + override). Si false → section masquée. */
  needsClientValidation: boolean;
  allowsClientRevision: boolean;
  /** Token actuellement actif (revokedAt null + non expiré). */
  initialActiveToken: ActiveToken | null;
  /** Historique des rounds de validation client (du plus récent au plus ancien). */
  rounds: ClientValidationRound[];
  currentUserRole: UserRole;
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function ClientValidationSection({
  slotId,
  slotStatus,
  needsClientValidation,
  allowsClientRevision,
  initialActiveToken,
  rounds,
  currentUserRole,
  sectionId = "client-validation",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: Props) {
  const router = useRouter();
  const isAdmin = currentUserRole === "ADMIN";

  const [activeToken, setActiveToken] = useState<ActiveToken | null>(initialActiveToken);
  // Stocké en mémoire uniquement après un POST réussi de génération.
  const [freshRawToken, setFreshRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [showManualConfirm, setShowManualConfirm] = useState<"approve" | "cancel" | null>(null);
  const [manualComment, setManualComment] = useState("");

  // Section masquée si pas de validation client requise
  if (!needsClientValidation) return null;

  const validationUrl = freshRawToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/validate/${freshRawToken}`
    : null;

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function handleGenerate() {
    setSubmitting("generate");
    try {
      const res = await fetch(`/api/admin/publications/${slotId}/validation-token`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as { tokenId: string; rawToken: string; expiresAt: string };
      setFreshRawToken(data.rawToken);
      setActiveToken({
        id: data.tokenId,
        createdAt: new Date().toISOString(),
        expiresAt: data.expiresAt,
        createdBy: null,
      });
      toast.success("Lien généré et copié — partagez-le au client");
      router.refresh();
      // Auto-copy au clipboard
      const url = `${window.location.origin}/validate/${data.rawToken}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // pas grave — l'utilisateur clique sur "Copier" manuellement
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur génération lien");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRevoke() {
    setSubmitting("revoke");
    try {
      const res = await fetch(`/api/admin/publications/${slotId}/validation-token`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      setActiveToken(null);
      setFreshRawToken(null);
      toast.success("Lien révoqué");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur révocation");
    } finally {
      setSubmitting(null);
      setShowRevokeConfirm(false);
    }
  }

  async function handleManualAction(action: "approve" | "cancel") {
    setSubmitting(`manual-${action}`);
    try {
      const res = await fetch(`/api/admin/publications/${slotId}/manual-validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: manualComment.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      toast.success(action === "approve" ? "Marqué comme validé" : "Marqué comme annulé");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur action manuelle");
    } finally {
      setSubmitting(null);
      setShowManualConfirm(null);
      setManualComment("");
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        toast.success("Lien copié");
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Erreur copie clipboard"),
    );
  }

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const isAwaiting = slotStatus === "AWAITING_CLIENT";
  const isResolved = ["SCHEDULED", "PUBLISHED", "CANCELLED", "ARCHIVED"].includes(slotStatus);

  return (
    <Section
      title="Validation client"
      icon={ShieldCheck}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={
        <span className="text-[11px] text-gray-500">
          {allowsClientRevision ? "Avec révisions" : "Validation simple"}
        </span>
      }
    >

      {/* ── État courant ───────────────────────────────────────────────────── */}
      {isAwaiting && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-amber-800">
            En attente de la réponse du client.
          </p>
          {activeToken && (
            <p className="text-xs text-amber-700 mt-1">
              Lien valide jusqu&apos;au{" "}
              {new Date(activeToken.expiresAt).toLocaleString("fr-FR", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      )}

      {slotStatus === "CLIENT_REVISION" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-amber-800">
            Le client a demandé des modifications. Corrigez puis renvoyez pour validation.
          </p>
        </div>
      )}

      {isResolved && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-gray-700 inline-flex items-center gap-1.5">
            {slotStatus === "SCHEDULED" && (
              <>
                <CheckCircle size={14} className="text-success-700" />
                Validée par le client.
              </>
            )}
            {slotStatus === "PUBLISHED" && (
              <>
                <CheckCircle size={14} className="text-success-700" />
                Publiée (validée auparavant).
              </>
            )}
            {slotStatus === "CANCELLED" && (
              <>
                <XCircle size={14} className="text-danger-700" />
                Annulée par le client.
              </>
            )}
            {slotStatus === "ARCHIVED" && "Archivée."}
          </p>
        </div>
      )}

      {/* ── Lien actif (admin uniquement) ──────────────────────────────────── */}
      {isAdmin && activeToken && validationUrl && (
        <div className="border border-gray-200 bg-gray-50 rounded-lg p-3 mb-4">
          <p className="text-xs font-medium text-gray-700 mb-2">
            Lien à partager au client
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={validationUrl}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded bg-white font-mono text-gray-700"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? Check : Copy}
              onClick={() => copyLink(validationUrl)}
            >
              {copied ? "Copié" : "Copier"}
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Ce lien ne sera plus jamais affiché après actualisation de la page.
            Régénérez-en un si vous l&apos;avez perdu.
          </p>
        </div>
      )}

      {isAdmin && activeToken && !validationUrl && (
        <div className="border border-gray-200 bg-gray-50 rounded-lg p-3 mb-4">
          <p className="text-xs text-gray-700 mb-2">
            <AlertTriangle size={12} className="inline mr-1 text-amber-500" />
            Un lien actif existe mais son URL complète n&apos;est plus accessible.
            Régénérez-en un pour repartager au client.
          </p>
          <p className="text-xs text-gray-500">
            Créé{" "}
            {new Date(activeToken.createdAt).toLocaleString("fr-FR", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {activeToken.createdBy && ` par ${activeToken.createdBy.name ?? activeToken.createdBy.email}`}
          </p>
        </div>
      )}

      {/* ── Actions admin ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-4">
          {!isResolved && (
            <Button
              variant="primary"
              size="sm"
              icon={activeToken ? RefreshCw : ExternalLink}
              loading={submitting === "generate"}
              onClick={handleGenerate}
            >
              {activeToken ? "Régénérer le lien" : "Envoyer pour validation"}
            </Button>
          )}

          {activeToken && !isResolved && (
            <Button
              variant="secondary"
              size="sm"
              icon={X}
              onClick={() => setShowRevokeConfirm(true)}
            >
              Révoquer
            </Button>
          )}

          {isAwaiting && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={Check}
                onClick={() => setShowManualConfirm("approve")}
                title="Bypass admin — ne déclenche PAS la chaîne post-validation (description / cover auto)"
              >
                Bypass admin (validé)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={() => setShowManualConfirm("cancel")}
                title="Bypass admin — annule la publication"
              >
                Bypass admin (annulé)
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── Historique des rounds ─────────────────────────────────────────── */}
      {rounds.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Historique ({rounds.length})
          </h3>
          <ul className="space-y-3">
            {rounds.map((r) => (
              <li key={r.roundNumber} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      r.action === "approved"
                        ? "bg-success-50 text-success-700"
                        : r.action === "rejected"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-danger-50 text-danger-700"
                    }`}
                  >
                    Round {r.roundNumber} ·{" "}
                    {r.action === "approved"
                      ? "Validé"
                      : r.action === "rejected"
                        ? "Modifications demandées"
                        : "Annulé"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.respondedAt).toLocaleString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-gray-700 mt-1 text-sm whitespace-pre-wrap">
                    « {r.comment} »
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={showRevokeConfirm}
        title="Révoquer le lien de validation ?"
        description="Le lien actuel ne fonctionnera plus. Le slot retournera en « Prêt pour CM »."
        confirmLabel="Révoquer"
        variant="danger"
        loading={submitting === "revoke"}
        onConfirm={handleRevoke}
        onCancel={() => setShowRevokeConfirm(false)}
      />

      <ConfirmDialog
        open={showManualConfirm !== null}
        title={
          showManualConfirm === "approve"
            ? "Bypass admin — marquer comme validé ?"
            : "Bypass admin — marquer comme annulé ?"
        }
        description={
          showManualConfirm === "approve"
            ? "⚠️ Ce n'est PAS une validation client. Le slot passe en « Programmé » sans déclencher la chaîne post-validation (description IA / cover auto). À utiliser uniquement si le client a validé par téléphone/WhatsApp et que tu veux juste avancer le statut."
            : "⚠️ Bypass admin — le slot passe en « Annulé ». Pas de validation client effectuée."
        }
        confirmLabel={showManualConfirm === "approve" ? "Bypass : valider" : "Bypass : annuler"}
        variant={showManualConfirm === "approve" ? "default" : "danger"}
        loading={submitting?.startsWith("manual-")}
        onConfirm={() => {
          if (showManualConfirm) void handleManualAction(showManualConfirm);
        }}
        onCancel={() => {
          setShowManualConfirm(null);
          setManualComment("");
        }}
      >
        <div className="mt-3 space-y-1">
          <span className="text-xs text-gray-600">Commentaire (optionnel)</span>
          <Textarea
            value={manualComment}
            onChange={setManualComment}
            placeholder="Raison de la décision manuelle…"
            rows={3}
            maxLength={2000}
          />
        </div>
      </ConfirmDialog>
    </Section>
  );
}
