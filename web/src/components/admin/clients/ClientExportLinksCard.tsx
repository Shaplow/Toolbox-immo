"use client";

/**
 * Carte « Liens de téléchargement » de la fiche client (onglet Infos, admin).
 *
 * Liste les liens déjà créés avec leur contenu, leur validité et ce que le
 * client en a fait (ouvert, téléchargement lancé, incomplet, terminé) — de quoi
 * savoir s'il faut relancer. Le jeton brut n'est jamais relu : une adresse
 * perdue se régénère (« Régénérer l'adresse », menu ⋯ de la ligne), ce qui
 * invalide l'ancienne. Le bouton d'en-tête « Nouveau lien », lui, crée un autre
 * lien et laisse les existants actifs : les deux libellés ne se ressemblent pas
 * exprès (cf. `LINK_ACTION_LABELS`).
 */

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Ban, CalendarPlus, Link2, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Card, CardHeader } from "@/components/ui/Card";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";
import type {
  ExportLinkAction,
  ExportLinkSummary,
  ExportLinkWithToken,
} from "@/lib/clientExport/types";
import { errorMessage, fetchExportLinks, updateExportLink } from "./clientExportApi";
import {
  CREATE_LINK_LABEL,
  EXTEND_LINK_DAYS,
  LINK_ACTION_LABELS,
  LINK_STATUS_BADGE,
  describeLinkActivity,
  describeLinkContent,
  describeLinkCreation,
  describeLinkValidity,
  exportLinkUrl,
  linkActions,
  linkTitle,
} from "./clientExportModel";
import { ExportLinkShare } from "./ExportLinkShare";

type MenuItems = ComponentProps<typeof DropdownMenu>["items"];

interface ClientExportLinksCardProps {
  clientId: string;
  /** Change à chaque lien créé depuis le tiroir : la liste se recharge. */
  refreshKey: number;
  /** Ouvre le tiroir « Nouveau lien de téléchargement ». */
  onCreate: () => void;
}

/** Adresse d'un lien régénéré, affichée une seule fois. */
interface RegeneratedLink {
  url: string;
  expiresAt: string;
}

const LOAD_ERROR_TITLE = "Impossible de charger les liens";

export function ClientExportLinksCard({ clientId, refreshKey, onCreate }: ClientExportLinksCardProps) {
  // `links` reste affiché pendant un rechargement : le squelette n'est que pour
  // le premier chargement, sinon la liste clignoterait après chaque action.
  const [links, setLinks] = useState<ExportLinkSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenerated, setRegenerated] = useState<RegeneratedLink | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchExportLinks(clientId, controller.signal);
        setLinks(response.links);
        setLoadError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(err, LOAD_ERROR_TITLE));
      }
    })();
    return () => controller.abort();
  }, [clientId, refreshKey, reloadTick]);

  function reload() {
    setReloadTick((n) => n + 1);
  }

  function retry() {
    setLoadError(null);
    reload();
  }

  async function mutate(
    link: ExportLinkSummary,
    action: ExportLinkAction,
  ): Promise<ExportLinkWithToken | null> {
    setBusyId(link.id);
    try {
      return await updateExportLink(clientId, link.id, action);
    } catch (err) {
      toast.error(errorMessage(err, "Impossible de modifier le lien"));
      // Un 404 ou un 409 vient presque toujours d'une liste périmée (lien révoqué
      // depuis un autre onglet) : on la recharge pour montrer l'état réel.
      reload();
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function handleExtend(link: ExportLinkSummary) {
    const result = await mutate(link, { action: "extend", days: EXTEND_LINK_DAYS });
    if (!result) return;
    toast.success(`Lien prolongé de ${EXTEND_LINK_DAYS} jours`);
    reload();
  }

  async function handleRevoke(link: ExportLinkSummary) {
    const ok = await confirm({
      title: "Révoquer ce lien ?",
      description:
        "Le client ne pourra plus télécharger. Les fichiers déjà téléchargés restent chez lui.",
      confirmLabel: LINK_ACTION_LABELS.revoke,
      variant: "danger",
    });
    if (!ok) return;
    const result = await mutate(link, { action: "revoke" });
    if (!result) return;
    toast.success("Lien révoqué");
    reload();
  }

  async function handleRotate(link: ExportLinkSummary) {
    // Le client peut être au milieu d'un téléchargement : couper l'ancienne
    // adresse est un geste à confirmer, comme la révocation.
    const ok = await confirm({
      title: `${LINK_ACTION_LABELS.rotate} ?`,
      description:
        "L'adresse actuelle cessera de fonctionner : il faudra envoyer la nouvelle au client. Le contenu du lien ne change pas.",
      confirmLabel: LINK_ACTION_LABELS.rotate,
    });
    if (!ok) return;
    const result = await mutate(link, { action: "rotate" });
    if (!result) return;
    reload();
    if (!result.rawToken) {
      // L'ancienne adresse est déjà coupée : seule une nouvelle régénération donnera la bonne.
      toast.error("L'adresse est régénérée mais n'a pas été renvoyée. Régénère-la de nouveau.");
      return;
    }
    setRegenerated({
      url: exportLinkUrl(window.location.origin, result.rawToken),
      expiresAt: result.link.expiresAt,
    });
  }

  let content: ReactNode;
  if (links === null && loadError === null) {
    content = <LoadingRows />;
  } else if (links === null) {
    content = (
      <div className="p-4">
        <Alert
          variant="danger"
          title={LOAD_ERROR_TITLE}
          actions={
            <Button size="sm" variant="secondary" onClick={retry}>
              Réessayer
            </Button>
          }
        >
          {loadError !== LOAD_ERROR_TITLE ? loadError : null}
        </Alert>
      </div>
    );
  } else if (links.length === 0) {
    content = (
      <div className="p-4">
        <EmptyState
          icon={Link2}
          title="Aucun lien pour l'instant"
          description="Crée un lien pour que le client télécharge ses vidéos, sons et données, rangés par compte Instagram."
        />
      </div>
    );
  } else {
    content = (
      <>
        {loadError && (
          <div className="border-b border-border p-3">
            <Alert
              variant="warning"
              actions={
                <Button size="sm" variant="secondary" onClick={retry}>
                  Réessayer
                </Button>
              }
            >
              La liste n&apos;a pas pu être actualisée : {loadError}
            </Alert>
          </div>
        )}
        <ul className="divide-y divide-border">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              busy={busyId === link.id}
              onRotate={() => void handleRotate(link)}
              onExtend={() => void handleExtend(link)}
              onRevoke={() => void handleRevoke(link)}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <Card padded={false}>
      <CardHeader
        title="Liens de téléchargement"
        actions={
          <Button size="sm" variant="secondary" icon={Plus} onClick={onCreate}>
            {CREATE_LINK_LABEL}
          </Button>
        }
      />
      {content}

      {dialog}

      {regenerated && (
        <Modal open onClose={() => setRegenerated(null)} size="lg" dismissOnBackdrop={false}>
          <Modal.Header onClose={() => setRegenerated(null)}>Adresse régénérée</Modal.Header>
          <Modal.Body className="space-y-3">
            <p className="text-[13px] text-foreground">
              L&apos;ancienne adresse ne fonctionne plus : envoie celle-ci au client.
            </p>
            <ExportLinkShare url={regenerated.url} expiresAt={regenerated.expiresAt} />
          </Modal.Body>
          <Modal.Footer>
            <Button onClick={() => setRegenerated(null)}>Terminé</Button>
          </Modal.Footer>
        </Modal>
      )}
    </Card>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Chargement des liens">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="block w-1/3" />
          <Skeleton className="block w-2/3" />
          <Skeleton className="block w-1/2" />
        </div>
      ))}
    </div>
  );
}

function LinkRow({
  link,
  busy,
  onRotate,
  onExtend,
  onRevoke,
}: {
  link: ExportLinkSummary;
  busy: boolean;
  onRotate: () => void;
  onExtend: () => void;
  onRevoke: () => void;
}) {
  const badge = LINK_STATUS_BADGE[link.status];

  const items: MenuItems = [];
  const actions = linkActions(link.status);
  if (actions.includes("rotate")) {
    items.push({ label: LINK_ACTION_LABELS.rotate, icon: RefreshCw, onClick: onRotate });
  }
  if (actions.includes("extend")) {
    items.push({ label: LINK_ACTION_LABELS.extend, icon: CalendarPlus, onClick: onExtend });
  }
  if (actions.includes("revoke")) {
    if (items.length > 0) items.push("separator");
    items.push({ label: LINK_ACTION_LABELS.revoke, icon: Ban, destructive: true, onClick: onRevoke });
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          {/* Le libellé se tronque (120 caractères permis), le badge reste à sa droite. */}
          <span className="min-w-0 truncate text-[13px] font-medium text-foreground" title={linkTitle(link)}>
            {linkTitle(link)}
          </span>
          <Badge variant={badge.variant} size="sm" className="shrink-0">
            {badge.label}
          </Badge>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {describeLinkCreation(link)} · {describeLinkValidity(link)}
        </p>
        <p className="text-[12px] text-muted-foreground">{describeLinkContent(link)}</p>
        <p className="text-[12px] text-foreground">{describeLinkActivity(link)}</p>
      </div>
      {items.length > 0 && (
        <DropdownMenu
          align="end"
          trigger={
            <ButtonIcon
              icon={MoreHorizontal}
              size="sm"
              label="Actions du lien"
              loading={busy}
              disabled={busy}
            />
          }
          items={items}
        />
      )}
    </li>
  );
}
