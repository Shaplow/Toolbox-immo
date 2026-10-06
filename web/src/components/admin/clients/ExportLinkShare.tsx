"use client";

/**
 * Le lien tout juste créé (ou régénéré), à copier et à envoyer au client.
 *
 * Le jeton brut n'existe qu'à cet instant : le serveur n'en garde que le hash.
 * Le bloc le dit sans détour, et tente de copier l'adresse d'office pour qu'un
 * onglet fermé trop vite ne coûte pas un lien.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { describeExpiry } from "./clientExportModel";

interface ExportLinkShareProps {
  url: string;
  /** Date d'expiration ISO : affichée au-dessus de l'adresse pour que l'admin la répète au client. */
  expiresAt?: string;
}

const COPIED_MS = 2000;

export function ExportLinkShare({ url, expiresAt }: ExportLinkShareProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopied = useCallback(() => {
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // Tentative silencieuse : le presse-papiers peut être refusé (contexte non
  // sécurisé, focus perdu, délai écoulé depuis le clic). Aucune erreur à
  // montrer — le bouton « Copier » reste là.
  useEffect(() => {
    try {
      void navigator.clipboard?.writeText(url).then(flashCopied, () => {});
    } catch {
      // Navigateur sans API presse-papiers : rien à faire.
    }
  }, [url, flashCopied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      flashCopied();
    } catch {
      toast.error("Copie impossible : sélectionne le lien et copie-le à la main.");
    }
  }

  return (
    <div className="space-y-3">
      {expiresAt && <p className="text-[13px] text-muted-foreground">{describeExpiry(expiresAt)}</p>}

      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={() => {}}
          readOnly
          aria-label="Lien de téléchargement"
          className="min-w-0 flex-1 font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="secondary"
          icon={copied ? Check : Copy}
          onClick={() => void handleCopy()}
          className="shrink-0"
        >
          {copied ? "Copié" : "Copier"}
        </Button>
      </div>

      <p className="text-[13px] text-foreground">
        À ouvrir dans Google Chrome ou Microsoft Edge, sur un ordinateur.
      </p>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Ce lien ne sera plus affiché : copie-le maintenant. Si tu le perds, utilise « Nouveau lien »
        dans la liste.
      </p>
    </div>
  );
}
