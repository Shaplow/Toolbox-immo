"use client";

/**
 * AutocutFailuresSection — les analyses auto en échec, groupées par cause.
 *
 * Vit en tête de la vue « select » de l'atelier Autocut, au-dessus de la liste
 * d'assets : le bouton « Analyser (N) » qui relance est déjà dans cette barre
 * d'outils, donc « voir → resélectionner → relancer » tient en deux clics sans
 * changer de vue. La vue review reste dédiée à la validation.
 *
 * Le regroupement (groupAutocutFailures) est partagé avec le serveur : un pack
 * RunPod qui tombe fait échouer ses 10 assets d'un coup, les lister un par un
 * n'apprendrait rien. Le message technique brut reste accessible en tooltip.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { groupAutocutFailures, type AutocutFailureItem } from "@/lib/mediaAutocut";

/** Au-delà, on tronque la liste de noms — le groupe reste sélectionnable en entier. */
const MAX_FILENAMES_SHOWN = 6;

interface Props {
  failures: AutocutFailureItem[];
  /** Remplace la sélection courante par ces assets (sans relancer). */
  onSelect: (assetIds: string[]) => void;
  /** Sélectionne puis soumet immédiatement un nouveau pack. */
  onRelaunch: (assetIds: string[]) => void;
  /** Désactive les actions pendant une soumission en cours. */
  busy?: boolean;
}

export function AutocutFailuresSection({ failures, onSelect, onRelaunch, busy = false }: Props) {
  if (failures.length === 0) return null;

  const groups = groupAutocutFailures(failures);
  const allIds = failures.map((f) => f.assetId);

  return (
    <Alert
      variant="danger"
      icon={AlertTriangle}
      title={`${failures.length} analyse${failures.length > 1 ? "s" : ""} en échec`}
      actions={
        <Button
          variant="outline"
          size="sm"
          icon={RefreshCw}
          disabled={busy}
          onClick={() => onRelaunch(allIds)}
        >
          Tout relancer ({failures.length})
        </Button>
      }
      className="mx-5 mt-3 shrink-0"
    >
      <ul className="flex flex-col gap-2 mt-1">
        {groups.map((group) => {
          const ids = group.items.map((i) => i.assetId);
          const shown = group.items.slice(0, MAX_FILENAMES_SHOWN);
          const hidden = group.items.length - shown.length;
          return (
            <li key={group.label} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                {group.detail ? (
                  <Tooltip content={group.detail}>
                    <span className="text-[12.5px] text-foreground cursor-help underline decoration-dotted decoration-border underline-offset-2">
                      {group.label}
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-[12.5px] text-foreground">{group.label}</span>
                )}
                <Badge variant="danger" size="sm" capitalize={false}>
                  {group.items.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onSelect(ids)}
                  className="ml-auto"
                >
                  Sélectionner
                </Button>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {shown.map((i) => i.filename).join(" · ")}
                {hidden > 0 ? ` (+${hidden})` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </Alert>
  );
}
