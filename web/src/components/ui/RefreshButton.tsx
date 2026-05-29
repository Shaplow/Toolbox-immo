"use client";

/**
 * RefreshButton — bouton de refresh manuel pour les pages avec données
 * polling/SSE. Garde le spinner 800ms minimum pour donner un feedback
 * visuel même sur connexion rapide.
 *
 * Utilise router.refresh() (Next.js App Router) qui re-fetch server side
 * sans full reload.
 *
 * Variants : compact (ButtonIcon ghost) | expanded (Button secondary
 * avec label).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "./Button";
import { ButtonIcon } from "./ButtonIcon";

interface Props {
  title?: string;
  variant?: "compact" | "expanded";
}

export function RefreshButton({
  title = "Rafraîchir",
  variant = "compact",
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  function handleClick() {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
    });
    setTimeout(() => setSpinning(false), 800);
  }

  const isSpinning = spinning || pending;

  if (variant === "expanded") {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={isSpinning}
        icon={RefreshCw}
        title={title}
        className={isSpinning ? "[&>svg]:animate-spin" : ""}
      >
        Rafraîchir
      </Button>
    );
  }

  return (
    <ButtonIcon
      icon={RefreshCw}
      label={title}
      onClick={handleClick}
      disabled={isSpinning}
      className={isSpinning ? "[&>svg]:animate-spin" : ""}
    />
  );
}
