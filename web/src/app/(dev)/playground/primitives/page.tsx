"use client";

/**
 * Page Components — primitives UI du design system (SaaS d'équipe).
 *
 * Doctrine : mono dark · density Linear · icon-first.
 * Le primary est `bg-gray-950` flat. Pas de gradient, pas de couleur, pas de glow.
 *
 * Pour les tokens marketing, voir `/playground/marketing`.
 */

import { useState } from "react";
import {
  ArrowRight,
  Search,
  Mail,
  AtSign,
  Hash,
  Lock,
  Plus,
  Trash2,
  Copy,
  MoreHorizontal,
  RefreshCw,
  X,
  Filter,
  Download,
  Check,
  Send,
  FileText,
  Layers,
  CheckCircle2,
  AlertCircle,
  List,
  CheckSquare,
  Archive,
  Eye,
  Pencil,
  ExternalLink,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { toast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Kbd, KbdChord } from "@/components/ui/Kbd";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Select } from "@/components/ui/Select";
import { HandDrawn } from "@/components/ui/decor/HandDrawn";

import { PageHeader } from "../_components/PageHeader";
import { ComponentDoc } from "../_components/ComponentDoc";
import { PreviewCanvas } from "../_components/PreviewCanvas";
import { VariantBlock } from "../_components/VariantBlock";
import { FamilyHeading } from "../_components/FamilyHeading";

export default function ComponentsPage() {
  const [handle, setHandle] = useState("lola_caupert");
  const [email, setEmail] = useState("contact@lacaupertstudio.fr");
  const [emailError, setEmailError] = useState("Format invalide.");
  const [search, setSearch] = useState("");
  const [caption, setCaption] = useState("Un appartement plein de charme, vue dégagée sur le parc.");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDangerOpen, setConfirmDangerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [activeFiltersTab, setActiveFiltersTab] = useState("active");
  const [autoCover, setAutoCover] = useState(true);
  const [notifications, setNotifications] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [frames, setFrames] = useState(36);
  const [status, setStatus] = useState("planned");
  const [pattern, setPattern] = useState("");
  const [selectError, setSelectError] = useState("manual");

  return (
    <div>
      <PageHeader
        eyebrow="Components"
        title="Primitives"
        description={
          <>
            Mono dark, density Linear, icon-first. Le primary est{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-gray-700">
              bg-gray-950
            </code>{" "}
            flat — pas de gradient, pas de couleur, pas de glow. La signature passe
            par la rigueur, pas par la déco.
          </>
        }
      />

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <FamilyHeading label="Actions" description="Boutons et menus pour déclencher des intentions." />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="button"
          title="Button"
          meta={["4 variants", "3 sizes", "icon prop"]}
          description="primary · secondary · ghost · danger. Sizes sm · md · lg. Loading et disabled gérés."
        >
          <PreviewCanvas align="start" padding="loose">
            <div className="grid grid-cols-[60px_repeat(4,minmax(0,1fr))] items-center gap-3 w-full text-xs">
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">Size</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">primary</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">secondary</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">ghost</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">danger</span>
              {(["sm", "md", "lg"] as const).map((size) => (
                <ButtonRow key={size} size={size} />
              ))}
            </div>
          </PreviewCanvas>

          <VariantBlock label="Avec icône" description="Recommandé pour actions significatives.">
            <PreviewCanvas align="start" padding="default">
              <div className="flex flex-wrap items-center gap-2">
                <Button icon={Plus}>Nouveau slot</Button>
                <Button variant="secondary" icon={Filter}>Filtrer</Button>
                <Button variant="secondary" icon={Download}>Exporter</Button>
                <Button variant="ghost" icon={RefreshCw}>Rafraîchir</Button>
                <Button variant="danger" icon={Trash2}>Supprimer</Button>
                <Button variant="ghost" icon={ArrowRight} iconRight>Continuer</Button>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <div className="grid gap-4 sm:grid-cols-2">
            <VariantBlock label="Loading">
              <PreviewCanvas align="start" padding="default">
                <div className="flex flex-wrap items-center gap-2">
                  <Button loading>Sauvegarder</Button>
                  <Button variant="secondary" loading icon={Send}>Envoi…</Button>
                </div>
              </PreviewCanvas>
            </VariantBlock>
            <VariantBlock label="Disabled">
              <PreviewCanvas align="start" padding="default">
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled>Sauvegarder</Button>
                  <Button variant="secondary" disabled icon={Lock}>Verrouillé</Button>
                  <Button variant="ghost" disabled>Disabled ghost</Button>
                </div>
              </PreviewCanvas>
            </VariantBlock>
          </div>
        </ComponentDoc>

        <ComponentDoc
          id="button-icon"
          title="ButtonIcon"
          meta={["toolbar pattern", "Linear/Raycast"]}
          description="Bouton icône seul avec label aria. Idéal en barre d'outils dense."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="flex items-center gap-1 w-full">
              <ButtonIcon icon={Plus} label="Ajouter" />
              <ButtonIcon icon={Copy} label="Dupliquer" />
              <ButtonIcon icon={RefreshCw} label="Rafraîchir" />
              <span className="mx-1 h-4 w-px bg-gray-200" />
              <ButtonIcon icon={MoreHorizontal} label="Plus d'actions" />
              <ButtonIcon icon={Trash2} label="Supprimer" variant="danger" />
              <span className="ml-auto" />
              <ButtonIcon icon={X} label="Fermer" />
            </div>
          </PreviewCanvas>
          <VariantBlock label="Loading">
            <PreviewCanvas align="start" padding="default">
              <ButtonIcon icon={RefreshCw} label="Rafraîchir" loading />
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="dropdown-menu"
          title="DropdownMenu"
          meta={["click trigger", "ESC closes"]}
          description="Menu d'actions au click. Items : action, séparateur, destructive. Click outside et ESC ferment."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="flex flex-wrap items-center gap-4">
              <DropdownMenu
                trigger={<ButtonIcon icon={MoreHorizontal} label="Plus d'actions" />}
                items={[
                  { label: "Aperçu",       icon: Eye,           onClick: () => toast.info("Aperçu") },
                  { label: "Éditer",       icon: Pencil,        onClick: () => toast.info("Éditer"), kbd: "E" },
                  { label: "Dupliquer",    icon: Copy,          onClick: () => toast.info("Dupliquer"), kbd: "⌘D" },
                  "separator",
                  { label: "Ouvrir dans une fiche", icon: ExternalLink, onClick: () => toast.info("Ouvrir") },
                  "separator",
                  { label: "Supprimer",    icon: Trash2,        destructive: true, onClick: () => toast.error("Supprimé.") },
                ]}
              />
              <DropdownMenu
                align="end"
                trigger={<Button variant="secondary" size="sm" icon={Filter}>Filtrer</Button>}
                items={[
                  { label: "Tous",      icon: List,         onClick: () => toast.info("Tous") },
                  { label: "Actifs",    icon: CheckSquare,  onClick: () => toast.info("Actifs") },
                  { label: "Archivés",  icon: Archive,      onClick: () => toast.info("Archivés") },
                  "separator",
                  { label: "Désactivé", disabled: true,    onClick: () => {} },
                ]}
              />
            </div>
          </PreviewCanvas>
        </ComponentDoc>
      </div>

      {/* ── Forms ────────────────────────────────────────────────────── */}
      <FamilyHeading label="Forms" description="Champs et contrôles pour la saisie utilisateur." />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="input"
          title="Input"
          meta={["icon-first", "trailing prop", "error state"]}
          description="Icône leading systématique sur les inputs typés. Slot trailing pour kbd/badges. Focus mono dark."
        >
          <PreviewCanvas align="start" padding="loose">
            <div className="grid gap-3 sm:grid-cols-2 w-full">
              <FormField label="Handle Instagram" required help="Sans le @.">
                <Input
                  value={handle}
                  onChange={setHandle}
                  icon={AtSign}
                  placeholder="lola_caupert"
                />
              </FormField>
              <FormField label="Email contact" error={emailError}>
                <Input
                  value={email}
                  onChange={(v) => {
                    setEmail(v);
                    setEmailError(v.includes("@") ? "" : "Format invalide.");
                  }}
                  icon={Mail}
                  placeholder="contact@studio.fr"
                />
              </FormField>
              <FormField label="ID du compte (lecture seule)">
                <Input
                  value="acc_8f3z2x9p"
                  onChange={() => {}}
                  icon={Hash}
                  disabled
                />
              </FormField>
              <FormField label="Mot de passe" required>
                <Input
                  value=""
                  onChange={() => {}}
                  icon={Lock}
                  type="password"
                  placeholder="••••••••"
                  trailing={
                    <kbd className="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono text-[10px] text-gray-500">
                      ⌘K
                    </kbd>
                  }
                />
              </FormField>
            </div>
          </PreviewCanvas>

          <VariantBlock label="Search · trailing badge">
            <PreviewCanvas align="start" padding="default">
              <Input
                value={search}
                onChange={setSearch}
                icon={Search}
                placeholder="Rechercher un slot, un compte, un template…"
                trailing={
                  <kbd className="rounded border border-gray-300 bg-gray-50 px-1 py-0.5 font-mono text-[10px] text-gray-500">
                    ⌘K
                  </kbd>
                }
              />
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="textarea"
          title="Textarea"
          meta={["resize-y", "rows prop"]}
          description="Même API qu'Input. Resize vertical autorisé, focus mono dark."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="w-full max-w-2xl">
              <FormField label="Légende Instagram" help="Cmd/Ctrl + Entrée pour valider.">
                <Textarea
                  value={caption}
                  onChange={setCaption}
                  rows={3}
                  placeholder="Écris la légende ici…"
                />
              </FormField>
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="select"
          title="Select"
          meta={["native wrapper", "icon optional"]}
          description="Wrapper du native <select> avec tokens UI. Pour menus avec icônes par option ou items custom, utiliser DropdownMenu à la place."
        >
          <PreviewCanvas align="start" padding="loose">
            <div className="grid gap-3 sm:grid-cols-2 w-full">
              <FormField label="Statut" required>
                <Select
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "planned",  label: "Planifié" },
                    { value: "shooting", label: "Tournage" },
                    { value: "edit",     label: "En montage" },
                    { value: "review",   label: "À valider" },
                    { value: "ready",    label: "Prêt" },
                  ]}
                />
              </FormField>
              <FormField label="Pattern" help="Sélectionne le pattern de publication.">
                <Select
                  value={pattern}
                  onChange={setPattern}
                  placeholder="Choisis un pattern…"
                  options={[
                    { value: "rpi",   label: "RPI · auto template" },
                    { value: "rtips", label: "RTIPS · auto template" },
                    { value: "manual", label: "Manual rushes" },
                    { value: "ext",   label: "External upload", disabled: true },
                  ]}
                />
              </FormField>
              <FormField label="Vidéaste assigné">
                <Select
                  value="vid-2"
                  onChange={() => {}}
                  icon={Eye}
                  options={[
                    { value: "vid-1", label: "Léa Vasseur" },
                    { value: "vid-2", label: "Marc Dubois" },
                    { value: "vid-3", label: "Sophie Martin" },
                  ]}
                />
              </FormField>
              <FormField label="Champ obligatoire (erreur)" error="Choisis une option valide.">
                <Select
                  value={selectError}
                  onChange={setSelectError}
                  options={[
                    { value: "manual", label: "Manual (invalide)" },
                    { value: "ok",     label: "OK option" },
                  ]}
                />
              </FormField>
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="form-field"
          title="FormField"
          meta={["label", "required", "help", "error"]}
          description="Wrapper sémantique label + required + help + error + children. À utiliser systématiquement autour des Inputs/Selects/Textareas."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="w-full max-w-lg space-y-3">
              <FormField label="Nom du compte" required help="Ce nom apparaîtra dans la sidebar.">
                <Input value="@studio.lamira" onChange={() => {}} icon={AtSign} />
              </FormField>
              <FormField label="Champ en erreur" error="Cette valeur existe déjà.">
                <Input value="@studio.lamira" onChange={() => {}} icon={AtSign} />
              </FormField>
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="switch"
          title="Switch"
          meta={["sm | md", "label + description"]}
          description="Toggle mono dark. Texte de label + description optionnelle. Variant sm pour toolbars."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="w-full max-w-md space-y-4">
              <Switch
                checked={autoCover}
                onChange={setAutoCover}
                label="Cover auto"
                description="Génère un pack de frames cover à chaque rendu vidéo."
              />
              <Switch
                checked={notifications}
                onChange={setNotifications}
                label="Notifications email"
                description="Recevoir un email à chaque slot publié."
              />
              <div className="flex items-center gap-3 pt-3 border-t border-gray-200/60">
                <Switch checked={autoCover} onChange={setAutoCover} size="sm" />
                <span className="text-[12px] text-gray-600">Switch sm sans label (toolbar compact)</span>
              </div>
              <Switch
                checked={false}
                onChange={() => {}}
                label="Désactivé"
                description="Switch disabled prop."
                disabled
              />
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="slider"
          title="Slider"
          meta={["min/max/step", "unit suffix", "showValue"]}
          description="Range mono dark. Pour options et configurations de panneaux."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="w-full max-w-md space-y-4">
              <Slider
                label="Volume musique"
                value={volume}
                onChange={setVolume}
                min={0}
                max={1}
                step={0.05}
                unit="%"
                showValue={false}
              />
              <Slider
                label="Frames cover proposées"
                value={frames}
                onChange={setFrames}
                min={6}
                max={72}
              />
              <Slider
                label="Slider disabled"
                value={42}
                onChange={() => {}}
                min={0}
                max={100}
                unit="px"
                disabled
              />
            </div>
          </PreviewCanvas>
        </ComponentDoc>
      </div>

      {/* ── Feedback ────────────────────────────────────────────────── */}
      <FamilyHeading label="Feedback" description="Communications transient et indicateurs d'état." />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="toast"
          title="Toast"
          meta={["success", "error", "info"]}
          description="Feedback transient. Icône colorée + texte mono. Auto-dismiss 4s, click pour fermer. Apparaît en bas à droite."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => toast.success("Slot créé avec succès.")}>
                toast.success
              </Button>
              <Button variant="secondary" onClick={() => toast.error("Échec : le compte n'existe plus.")}>
                toast.error
              </Button>
              <Button variant="secondary" onClick={() => toast.info("Synchronisation en cours…")}>
                toast.info
              </Button>
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="empty-state"
          title="EmptyState"
          meta={["icon + title + CTA"]}
          description="Icône wrapper + titre + description + CTA optionnel. Pour les empty states signature (Caveat + Check handdraw), voir Signature ci-dessous."
        >
          <PreviewCanvas align="start" padding="loose">
            <div className="grid gap-4 sm:grid-cols-2 w-full">
              <EmptyState
                icon={FileText}
                title="Aucun template disponible"
                description="Crée un template pour commencer à générer des publications automatiquement."
                cta={{ label: "Nouveau template", onClick: () => toast.info("Click sur CTA") }}
              />
              <EmptyState
                icon={Layers}
                title="Aucune bibliothèque"
                description="Les bibliothèques permettent de réutiliser des médias entre comptes."
              />
            </div>
          </PreviewCanvas>
        </ComponentDoc>

        <ComponentDoc
          id="skeleton"
          title="Skeleton"
          meta={["line | block | circle", "SkeletonRow"]}
          description="Loading placeholder. Shape configurable. SkeletonRow pour les rows de listes."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <VariantBlock label="Shapes">
              <PreviewCanvas align="start" padding="default">
                <div className="w-full space-y-3">
                  <Skeleton className="w-3/4" />
                  <Skeleton className="w-1/2" />
                  <Skeleton className="w-2/3" />
                  <div className="flex items-center gap-3 pt-2">
                    <Skeleton shape="circle" className="h-10 w-10" />
                    <Skeleton shape="block" className="h-10 flex-1" />
                  </div>
                </div>
              </PreviewCanvas>
            </VariantBlock>
            <VariantBlock label="SkeletonRow (helper)">
              <PreviewCanvas align="start" padding="default">
                <div className="w-full space-y-3">
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </div>
              </PreviewCanvas>
            </VariantBlock>
          </div>
        </ComponentDoc>

        <ComponentDoc
          id="tooltip"
          title="Tooltip"
          meta={["hover/focus", "top default"]}
          description="Apparaît après 200ms. Position top par défaut, fallback bottom si pas la place. bg-gray-950, text-[11px], shadow-overlay."
        >
          <PreviewCanvas align="center" padding="loose">
            <div className="flex flex-wrap items-center gap-4">
              <Tooltip content="Action rapide depuis n'importe où">
                <ButtonIcon icon={Plus} label="Nouveau" />
              </Tooltip>
              <Tooltip content="Rafraîchir la liste">
                <ButtonIcon icon={RefreshCw} label="Rafraîchir" />
              </Tooltip>
              <Tooltip
                content={
                  <>
                    <span>Ouvrir la palette</span>
                    <kbd className="ml-1.5 font-mono text-[10px] opacity-70">⌘K</kbd>
                  </>
                }
              >
                <Button variant="secondary" size="sm" icon={Search}>Rechercher</Button>
              </Tooltip>
              <Tooltip content="Tooltip en dessous" side="bottom">
                <span className="cursor-help underline decoration-dotted text-[12px] text-gray-700">
                  survol moi (bottom)
                </span>
              </Tooltip>
            </div>
          </PreviewCanvas>
        </ComponentDoc>
      </div>

      {/* ── Overlays ────────────────────────────────────────────────── */}
      <FamilyHeading label="Overlays" description="Surfaces qui passent au-dessus du contenu." />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="confirm-dialog"
          title="ConfirmDialog"
          meta={["focus trap", "ESC closes", "danger variant"]}
          description="Modal de confirmation centrée. Autofocus sur Confirmer. Variant danger pour actions destructives."
        >
          <PreviewCanvas align="start" padding="default">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
                Confirmer une action
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDangerOpen(true)}>
                Confirmer une action destructive
              </Button>
            </div>
          </PreviewCanvas>
          <ConfirmDialog
            open={confirmOpen}
            title="Marquer ce slot comme publié ?"
            description="Le slot passera en statut Publié et apparaîtra dans la home des CM."
            confirmLabel="Marquer publié"
            onConfirm={() => {
              toast.success("Slot marqué publié.");
              setConfirmOpen(false);
            }}
            onCancel={() => setConfirmOpen(false)}
          />
          <ConfirmDialog
            open={confirmDangerOpen}
            variant="danger"
            title="Supprimer cette publication ?"
            description="Cette action est irréversible. Le slot, ses versions, brief et rushes seront supprimés."
            confirmLabel="Supprimer définitivement"
            onConfirm={() => {
              toast.success("Publication supprimée.");
              setConfirmDangerOpen(false);
            }}
            onCancel={() => setConfirmDangerOpen(false)}
          />
        </ComponentDoc>

        <ComponentDoc
          id="delete-button"
          title="DeleteButton"
          meta={["icon + ConfirmDialog"]}
          description="Encapsule le pattern « icône Trash → ConfirmDialog danger ». Props itemLabel + onConfirm."
        >
          <PreviewCanvas align="center" padding="default">
            <div className="inline-flex items-center gap-3 text-[12px] text-gray-500">
              Supprimer ce slot →
              <DeleteButton
                itemLabel="ce slot"
                onConfirm={() => toast.success("Slot supprimé.")}
              />
            </div>
          </PreviewCanvas>
        </ComponentDoc>
      </div>

      {/* ── Data display ──────────────────────────────────────────── */}
      <FamilyHeading label="Data display" description="Visualisation de statuts, contenu et navigation." />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="badge"
          title="Badge"
          meta={["4 variants", "sm | md", "dot prop"]}
          description="Pill sémantique pour statuts, comptes, tags. Pas de variant brand — le brand est chirurgical, pas pour les badges."
        >
          <VariantBlock label="Variants">
            <PreviewCanvas align="start" padding="default">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>brouillon</Badge>
                <Badge variant="success">validé</Badge>
                <Badge variant="danger">refusé</Badge>
                <Badge variant="info">programmé</Badge>
                <Badge variant="success" dot>publié</Badge>
                <Badge variant="info" dot>en attente</Badge>
                <Badge variant="danger" dot>annulé</Badge>
                <Badge dot>nouveau</Badge>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Sizes + icônes">
            <PreviewCanvas align="start" padding="default">
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="sm">petit</Badge>
                <Badge size="md">moyen</Badge>
                <Badge size="sm" variant="success" icon={CheckCircle2}>validé</Badge>
                <Badge size="md" variant="danger" icon={AlertCircle}>erreur</Badge>
              </div>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="card"
          title="Card"
          meta={["interactive", "padded prop", "CardHeader"]}
          description="Conteneur sobre. `interactive` ajoute le hover lift. CardHeader pour les patterns avec header + actions."
        >
          <VariantBlock label="Variants">
            <PreviewCanvas align="start" padding="default">
              <div className="grid gap-3 sm:grid-cols-3 w-full">
                <Card>
                  <h3 className="text-sm font-medium text-gray-950">Card standard</h3>
                  <p className="mt-1 text-[12px] text-gray-500">Sobre, pas cliquable. Le conteneur par défaut.</p>
                </Card>
                <Card interactive>
                  <h3 className="text-sm font-medium text-gray-950">Card interactive</h3>
                  <p className="mt-1 text-[12px] text-gray-500">Hover lift + cursor pointer. Pour cards cliquables.</p>
                </Card>
                <Card border={false} className="bg-gray-50/40">
                  <h3 className="text-sm font-medium text-gray-950">Card sans border</h3>
                  <p className="mt-1 text-[12px] text-gray-500">Fond subtle pour distinguer sans border.</p>
                </Card>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="CardHeader · pattern toolbar">
            <PreviewCanvas align="start" padding="default">
              <Card padded={false} className="w-full">
                <CardHeader
                  title="Slots cette semaine"
                  actions={
                    <>
                      <ButtonIcon icon={Filter} label="Filtrer" size="sm" />
                      <ButtonIcon icon={RefreshCw} label="Rafraîchir" size="sm" />
                      <Button size="sm" icon={Plus}>Nouveau</Button>
                    </>
                  }
                />
                <div className="p-5 text-[13px] text-gray-700">
                  <p>Body de la card. Le pattern padded=false + CardHeader permet d&apos;avoir un header différencié.</p>
                </div>
              </Card>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Mockup liste dense (Linear-like)" description="Inputs typés + ButtonIcon + Badge + row hover.">
            <PreviewCanvas align="start" padding="default">
              <div className="w-full rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/40 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-medium">
                      Slots cette semaine
                    </span>
                    <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-mono text-gray-600">12</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ButtonIcon icon={Filter} label="Filtrer" size="sm" />
                    <ButtonIcon icon={RefreshCw} label="Rafraîchir" size="sm" />
                    <Button size="sm" icon={Plus}>Nouveau</Button>
                  </div>
                </div>
                <ul className="divide-y divide-gray-100">
                  {[
                    { time: "20:00", title: "RPI", account: "@lola_caupert", role: "M", done: true },
                    { time: "14:30", title: "Reels appartement", account: "@studio.lamira", role: "C", done: false },
                    { time: "09:00", title: "Story brief", account: "@toolbox.studio", role: "V", done: false },
                  ].map((s) => (
                    <li
                      key={s.title}
                      className="group/row flex items-center gap-3 px-4 py-2 text-[13px] transition-colors hover:bg-gray-50 cursor-pointer"
                    >
                      <span className="font-mono text-[11px] text-gray-400 w-12">{s.time}</span>
                      <span className="font-medium text-gray-950 flex-1 truncate">{s.title}</span>
                      <span className="text-gray-500">{s.account}</span>
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-700">
                        {s.role}
                      </span>
                      {s.done ? (
                        <Check size={14} className="text-gray-950" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                      )}
                      <ButtonIcon
                        icon={MoreHorizontal}
                        label="Plus"
                        size="sm"
                        className="opacity-0 group-hover/row:opacity-100"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="tabs"
          title="Tabs"
          meta={["line | pill", "icon + badge"]}
          description="2 variants : line (default, underline Linear-like) pour navigation principale, pill (segmented) pour filtres compacts."
        >
          <VariantBlock label="Line tabs · navigation principale">
            <PreviewCanvas align="start" padding="default">
              <div className="w-full space-y-2">
                <Tabs
                  value={activeTab}
                  onChange={setActiveTab}
                  items={[
                    { id: "all",     label: "Tous",      icon: List,         badge: <Badge size="sm">12</Badge> },
                    { id: "active",  label: "En cours",  icon: CheckSquare,  badge: <Badge size="sm" variant="info">4</Badge> },
                    { id: "archived", label: "Archivés", icon: Archive },
                    { id: "deleted", label: "Supprimés", disabled: true },
                  ]}
                />
                <p className="text-[12px] text-gray-500">
                  Tab actif : <code className="font-mono">{activeTab}</code>
                </p>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Pill tabs · filtres compacts">
            <PreviewCanvas align="start" padding="default">
              <Tabs
                variant="pill"
                size="sm"
                value={activeFiltersTab}
                onChange={setActiveFiltersTab}
                items={[
                  { id: "active",   label: "Actifs" },
                  { id: "all",      label: "Tous" },
                  { id: "archived", label: "Archivés" },
                ]}
              />
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>

        <ComponentDoc
          id="kbd"
          title="Kbd"
          meta={["isolated", "KbdChord combo"]}
          description="Raccourci clavier mono. Kbd seul ou KbdChord pour un combo. Sizes sm/md."
        >
          <VariantBlock label="Touches isolées">
            <PreviewCanvas align="start" padding="default">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-gray-700">
                <span>Ouvrir la palette : <Kbd>⌘</Kbd> <Kbd>K</Kbd></span>
                <span>Sauver : <KbdChord keys={["⌘", "S"]} /></span>
                <span>Annuler : <KbdChord keys={["⌘", "Z"]} /></span>
                <span>Refaire : <KbdChord keys={["⌘", "⇧", "Z"]} /></span>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Inline (taille md)">
            <PreviewCanvas align="start" padding="default">
              <p className="text-[13px] text-gray-700">
                Duplique un slot avec <KbdChord size="md" keys={["⌘", "D"]} /> depuis le calendrier.
              </p>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>
      </div>

      {/* ── Signature ───────────────────────────────────────────────── */}
      <FamilyHeading
        label="Signature"
        description="Caveat + 1 décor handdraw autorisés en SaaS sur ces micro-spots seulement."
      />

      <div className="space-y-2 mt-4">
        <ComponentDoc
          id="signature"
          title="Signature discrète"
          meta={["font-hand", "HandDrawn.Check", "HandDrawn.Arrow"]}
          description="Micro-doses signature dans l'UI courante. Le reste reste pour /playground/marketing."
        >
          <VariantBlock label="Empty states avec signature">
            <PreviewCanvas align="center" padding="loose">
              <div className="grid gap-4 sm:grid-cols-2 w-full">
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center space-y-3">
                  <HandDrawn.Check className="h-7 w-7 text-gray-950 mx-auto" />
                  <p className="font-hand text-2xl text-gray-950 leading-none">Tout est à jour</p>
                  <p className="text-[12px] text-gray-500 max-w-xs mx-auto">
                    Aucun slot en attente de ton attention pour cette semaine.
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center space-y-3">
                  <p className="font-hand text-2xl text-gray-950 leading-none">Aucun template ici</p>
                  <p className="text-[12px] text-gray-500 max-w-xs mx-auto">
                    Crée un template pour commencer.
                  </p>
                  <div className="pt-2">
                    <Button size="sm" icon={Plus}>Nouveau template</Button>
                  </div>
                </div>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Pills signature · lien narratif">
            <PreviewCanvas align="start" padding="default">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5">
                  <span className="font-hand text-[13px] text-gray-950 leading-none">astuce</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5">
                  <span className="font-hand text-[13px] text-gray-950 leading-none">beta</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5">
                  <span className="font-hand text-[13px] text-gray-950 leading-none">nouveau</span>
                </span>
                <a className="group inline-flex items-center gap-1.5 font-hand text-[15px] text-gray-700 hover:text-gray-950 transition-colors cursor-pointer">
                  voir tout
                  <HandDrawn.Arrow className="h-2.5 w-6 transition-transform group-hover:translate-x-0.5" />
                </a>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Tip callout">
            <PreviewCanvas align="start" padding="default">
              <div className="w-full max-w-xl border-l-2 border-gray-950 bg-gray-50 pl-4 py-3 pr-4 rounded-r-md">
                <p className="font-hand text-[15px] text-gray-950 leading-none mb-1">astuce</p>
                <p className="text-[13px] text-gray-700 leading-relaxed">
                  Tu peux dupliquer un slot existant via{" "}
                  <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-mono">⌘D</kbd>
                  {" "}depuis le calendrier.
                </p>
              </div>
            </PreviewCanvas>
          </VariantBlock>

          <VariantBlock label="Status « fait » · row signature" description="HandDrawn.Check réservée aux steps de publication / milestones. Pour les listes denses, utiliser Check Lucide.">
            <PreviewCanvas align="start" padding="default">
              <ul className="w-full max-w-md divide-y divide-gray-100">
                {[
                  { task: "Brief rédigé", done: true },
                  { task: "Rushes uploadés", done: true },
                  { task: "Montage validé", done: false },
                  { task: "Légende relue", done: false },
                ].map((step) => (
                  <li
                    key={step.task}
                    className="flex items-center gap-3 px-2 py-2 text-[13px]"
                  >
                    {step.done ? (
                      <HandDrawn.Check className="h-4 w-4 text-gray-950 shrink-0" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-gray-300 shrink-0" />
                    )}
                    <span className={step.done ? "text-gray-500 line-through" : "text-gray-950"}>
                      {step.task}
                    </span>
                  </li>
                ))}
              </ul>
            </PreviewCanvas>
          </VariantBlock>
        </ComponentDoc>
      </div>

      <p className="border-t border-gray-200 pt-6 mt-16 text-[11px] text-gray-400">
        Cette page grossira au fil de la Phase 1. Chaque nouvelle primitive
        ajoute une fiche ici avant d&apos;être propagée dans l&apos;app.
      </p>
    </div>
  );
}

function ButtonRow({ size }: { size: "sm" | "md" | "lg" }) {
  return (
    <>
      <code className="text-[10px] font-mono text-gray-400">{size}</code>
      <Button size={size} icon={Plus}>Button</Button>
      <Button variant="secondary" size={size}>Button</Button>
      <Button variant="ghost" size={size}>Button</Button>
      <Button variant="danger" size={size} icon={Trash2}>Button</Button>
    </>
  );
}
