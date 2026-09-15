"use client";

/**
 * SlotAccountLine — « d'où part ce post, et qui est invité dessus ».
 *
 * Deux endroits l'affichent, et c'est voulu : la section Légende (juste avant
 * que le CM copie le texte et bascule vers Instagram) et la section Publication
 * (au retour, quand il colle le lien). L'invitation en collaborateur se fait
 * dans le composer Instagram, entre les deux — un rappel à un seul de ces deux
 * moments arriverait trop tôt ou trop tard.
 *
 * Le compte principal s'affiche même sans collab : jusqu'ici la section
 * Publication ne disait PAS de quel compte elle parlait, et `mark-published`
 * pouvait répondre « Assignez d'abord un compte Instagram » sans que rien à
 * l'écran ne l'ait laissé deviner.
 */

import { AtSign, Users } from "lucide-react";

export interface SlotAccountLineProps {
  account: { id: string; handle: string; name: string } | null;
  collabs: { id: string; handle: string }[];
  /** `compact` pour un en-tête de section, `block` pour un encart. */
  variant?: "compact" | "block";
}

export function SlotAccountLine({ account, collabs, variant = "block" }: SlotAccountLineProps) {
  const hasCollabs = collabs.length > 0;

  if (variant === "compact") {
    if (!account && !hasCollabs) return null;
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <AtSign size={11} className="shrink-0" />
        <span className="text-foreground">{account ? account.handle : "sans compte"}</span>
        {hasCollabs && (
          <>
            <Users size={11} className="shrink-0" />
            <span className="text-foreground">
              {collabs.map((c) => `@${c.handle}`).join(", ")}
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-[12.5px] leading-relaxed ${
        hasCollabs
          ? "bg-info-50 border border-info-200 text-info-700"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {hasCollabs ? (
        <Users size={14} className="shrink-0 mt-0.5" />
      ) : (
        <AtSign size={14} className="shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        {account ? (
          <p>
            Poster depuis <span className="font-medium text-foreground">@{account.handle}</span>
            {hasCollabs && (
              <>
                {" — et inviter "}
                <span className="font-medium text-foreground">
                  {collabs.map((c) => `@${c.handle}`).join(", ")}
                </span>
                {collabs.length > 1 ? " en collaborateurs." : " en collaborateur."}
              </>
            )}
          </p>
        ) : (
          <p>
            Aucun compte Instagram sur cette publication — il faut en assigner un avant de pouvoir
            la marquer publiée.
          </p>
        )}
      </div>
    </div>
  );
}
