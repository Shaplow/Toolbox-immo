"use client";

/**
 * Phase 5 · Lot 2 — Patterns métier.
 *
 * 5 layouts réalistes qui assemblent primitives + atomes + molécules :
 * - Fiche détail (publication)
 * - Quick edit drawer (slot)
 * - Listing grid (médias)
 * - Tool page (preset editor)
 * - Admin table (utilisateurs)
 *
 * L'épreuve du feu des combos — si quelque chose casse dans la matière,
 * ça se voit ici.
 */

import { useState } from "react";
import {
  Bookmark,
  Calendar as CalIcon,
  Captions,
  ChevronRight,
  Eye,
  FileText,
  Home,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserCircle2,
  Video,
  X,
} from "lucide-react";

// Primitives
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Tabs } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { Combobox } from "@/components/ui/Combobox";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Avatar } from "@/components/ui/Avatar";

// Molécules
import { Section } from "@/components/ui/molecules/Section";
import { SoftPanel } from "@/components/ui/molecules/SoftPanel";
import { StatusBadge } from "@/components/ui/molecules/StatusBadge";
import { Stepper, type Step } from "@/components/ui/Stepper";
import { AssigneePicker } from "@/components/ui/molecules/AssigneePicker";
import { OverrideControl } from "@/components/ui/molecules/OverrideControl";
import { AssetCard } from "@/components/ui/molecules/AssetCard";
import { FilterBar } from "@/components/ui/molecules/FilterBar";
import { JobQueueItem } from "@/components/ui/molecules/JobQueueItem";
import { Pagination } from "@/components/ui/Pagination";
import { Table, type TableColumn } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";

// ─── Helpers locaux ─────────────────────────────────────────────────────────

function PatternHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="space-y-2 mb-6">
      <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h2>
      <p className="text-[13px] text-gray-600 max-w-2xl leading-relaxed">{description}</p>
    </header>
  );
}

// Sample users + assets mockés réutilisés.
const USERS = [
  { id: "u-alice", name: "Alice Dubois",     email: "alice@toolbox.fr",   role: "MONTEUR" as const },
  { id: "u-bob",   name: "Bob Martin",       email: "bob@toolbox.fr",     role: "MONTEUR" as const },
  { id: "u-clara", name: "Clara Petit",      email: "clara@toolbox.fr",   role: "MONTEUR" as const },
  { id: "u-diane", name: "Diane Roux",       email: "diane@toolbox.fr",   role: "CM" as const },
  { id: "u-eric",  name: "Eric Lambert",     email: "eric@toolbox.fr",    role: "CM" as const },
  { id: "u-fabio", name: "Fabio Cinque",     email: "fabio@toolbox.fr",   role: "VIDEASTE" as const },
  { id: "u-greg",  name: "Grégoire Vacher",  email: "greg@toolbox.fr",    role: "VIDEASTE" as const },
];

const ASSETS = Array.from({ length: 12 }, (_, i) => ({
  id: `a-${i + 1}`,
  url: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`,
  filename: [
    "rooftop-paris-final.mp4",
    "cuisine-ouverte-v3.mp4",
    "salon-vue-final.mp4",
    "chambre-luxe.mp4",
    "balcon-mer.mp4",
    "loft-industriel.mp4",
    "duplex-design.mp4",
    "terrasse-jardin.mp4",
    "cover-v2.jpg",
    "cover-v3.jpg",
    "hero-immersion.mp4",
    "story-final.mp4",
  ][i],
  duration: [18, 24, 42, 30, 15, 22, 35, 27, undefined, undefined, 50, 19][i],
  thumbnail: `https://picsum.photos/seed/asset-${i + 1}/400/600`,
  mimeType: i === 8 || i === 9 ? "image/jpeg" : "video/mp4",
}));

// ─── Page ───────────────────────────────────────────────────────────────────

export default function PatternsPage() {
  return (
    <div className="space-y-20">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 5 · Lot 2 · Patterns métier
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          5 layouts réalistes — l&apos;épreuve du feu
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          Si la matière fonctionne dans ces 5 patterns, elle fonctionnera dans
          l&apos;app entière. Pas des démos isolées — des combos primitives +
          atomes + molécules dans leurs vrais contextes métier Toolbox.
        </p>
      </header>

      <section id="fiche-detail" className="scroll-mt-20">
        <PatternHeader
          eyebrow="Pattern 1 · Fiche pub"
          title="Fiche détail"
          description="Header avec breadcrumb + status + assignations + actions. ProductionChain horizontale Stepper cards. Sections empilées avec StatusBadge. Comments thread."
        />
        <FicheDetailPattern />
      </section>

      <section id="quick-edit-drawer" className="scroll-mt-20">
        <PatternHeader
          eyebrow="Pattern 2 · Drawer édition"
          title="Quick edit drawer"
          description="Trigger ouvre Drawer side right large. 4 Tabs : Statut / Assignations / Overrides / Planning. Tous les pickers et OverrideControl en action."
        />
        <QuickEditDrawerPattern />
      </section>

      <section id="listing-grid" className="scroll-mt-20">
        <PatternHeader
          eyebrow="Pattern 3 · Médias"
          title="Listing grid"
          description="FilterBar sticky en tête (recherche + Combobox + Chips). Grid AssetCard 9:16 selectable. Bulk action bar quand sélection. Pagination en bas."
        />
        <ListingGridPattern />
      </section>

      <section id="tool-page" className="scroll-mt-20">
        <PatternHeader
          eyebrow="Pattern 4 · Édition longue"
          title="Tool page"
          description="SoftPanel avec breadcrumb header sticky. Form long (Input + Textarea + Select + Switch + DatePicker). Section jobs en cours stack JobQueueItem. Toolbar bottom Annuler / Sauvegarder."
        />
        <ToolPagePattern />
      </section>

      <section id="admin-table" className="scroll-mt-20">
        <PatternHeader
          eyebrow="Pattern 5 · Admin"
          title="Admin table"
          description="FilterBar + bouton Nouveau. Table sortable + selectable. Click row ouvre Modal édition. Bulk action quand sélection multiple. Pagination footer."
        />
        <AdminTablePattern />
      </section>
    </div>
  );
}

// ─── Pattern 1 : Fiche détail ──────────────────────────────────────────────

function FicheDetailPattern() {
  const [activeStep, setActiveStep] = useState<string | number>("captions");
  const [monteurId, setMonteurId] = useState<string | null>("u-bob");
  const [cmId, setCmId] = useState<string | null>("u-diane");
  const [comment, setComment] = useState("");

  const steps: Step[] = [
    { id: "brief",    label: "Brief",    description: "Recevoir les infos client" },
    { id: "rushes",   label: "Rushes",   description: "Tournage validé" },
    { id: "edit",     label: "Montage",  description: "Approuvé par Bob" },
    { id: "captions", label: "Captions", description: "Sous-titres en cours" },
    { id: "cover",    label: "Cover",    description: "À générer" },
    { id: "publish",  label: "Publish",  description: "Programmé" },
  ];

  return (
    <div className="space-y-4">
      {/* Top header glass */}
      <div className="rounded-2xl px-5 py-4 bg-gradient-to-b from-white to-white/85 backdrop-blur-[12px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
        <Breadcrumb
          items={[
            { href: "/", label: "Toolbox", icon: <Home size={12} /> },
            { href: "/calendar", label: "Calendrier" },
            { href: "/clients/studio-paris", label: "@studio-paris" },
            { label: "Story carrousel #18" },
          ]}
        />
        <div className="flex items-start justify-between gap-4 mt-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-semibold tracking-tight text-gray-950 truncate">
              Story carrousel #18 — Rooftop Paris
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusBadge domain="slot" status="CAPTIONS_PENDING" />
              <Badge variant="info" icon={CalIcon}>Programmé · 18 juin 18 h</Badge>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[11px] text-gray-500">Pattern</span>
                <Chip variant="sky" size="sm">Vidéo Story</Chip>
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Tooltip content="Aperçu plein écran"><ButtonIcon icon={Eye} label="Aperçu" variant="secondary" /></Tooltip>
            <Button icon={Send} variant="primary">Publier maintenant</Button>
            <ButtonIcon icon={MoreHorizontal} label="Plus" variant="ghost" />
          </div>
        </div>
      </div>

      {/* Production chain */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-2 px-1">
          Chaîne de production
        </p>
        <Stepper
          variant="glass"
          steps={steps}
          active={activeStep}
          onClickStep={(s) => setActiveStep(s.id)}
        />
      </div>

      {/* 2-cols layout : sections gauche + sidebar droite */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-3 min-w-0">
          <Section
            title="Brief client"
            description="Recevoir et valider les infos du client"
            icon={FileText}
            actions={<StatusBadge domain="cover" status="READY" />}
            collapsible
          >
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Visite guidée du 3 pièces, 65 m² avec balcon. Mise en avant de
              la cuisine ouverte (10 m²) et de la vue Sacré-Cœur depuis le séjour.
              Ambiance lumineuse, plans larges sur les volumes.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Chip variant="sage" size="sm">3 pièces</Chip>
              <Chip variant="sage" size="sm">Cuisine ouverte</Chip>
              <Chip variant="peach" size="sm">Vue Sacré-Cœur</Chip>
            </div>
          </Section>

          <Section
            title="Captions"
            description="Génération sous-titres en cours via Whisper"
            icon={Captions}
            actions={<StatusBadge domain="caption" status="GENERATING" />}
          >
            <JobQueueItem
              job={{
                id: "j-cap",
                domain: "caption",
                status: "GENERATING",
                title: "Whisper large-v3",
                description: "47 mots détectés sur 18 secondes",
                progress: 65,
                startedAt: new Date(Date.now() - 4 * 60_000),
              }}
            />
          </Section>

          <Section
            title="Comments"
            icon={Mail}
            description="Discussion équipe sur le slot"
          >
            <div className="space-y-3">
              {[
                { user: "Bob Martin", role: "Monteur", time: "il y a 2 h", text: "Montage v2 prêt, j'ai corrigé la cuisine selon les feedbacks." },
                { user: "Diane Roux", role: "CM", time: "il y a 1 h", text: "Top, je valide ! On peut enchaîner sur les captions." },
              ].map((c, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Avatar name={c.user} size="sm" />
                  <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                    <div className="flex items-baseline gap-2 mb-1">
                      <p className="text-[12px] font-semibold text-gray-950">{c.user}</p>
                      <p className="text-[10px] text-gray-500">{c.role} · {c.time}</p>
                    </div>
                    <p className="text-[12px] text-gray-700 leading-relaxed">{c.text}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 pt-2">
                <Avatar name="Mathis Barbet" size="sm" />
                <div className="flex-1 flex items-center gap-2">
                  <Input value={comment} onChange={setComment} placeholder="Ajouter un commentaire…" />
                  <Button size="sm" onClick={() => { setComment(""); toast.success("Commentaire posté."); }}>
                    Poster
                  </Button>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Sidebar : assignations + metadata */}
        <aside className="space-y-3">
          <Section title="Assignations" icon={UserCircle2} padded>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Monteur</p>
                <AssigneePicker
                  value={monteurId}
                  onChange={setMonteurId}
                  users={USERS}
                  allowedRoles={["MONTEUR"]}
                  groupByRole={false}
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">CM</p>
                <AssigneePicker
                  value={cmId}
                  onChange={setCmId}
                  users={USERS}
                  allowedRoles={["CM"]}
                  groupByRole={false}
                />
              </div>
            </div>
          </Section>

          <Section title="Détails" icon={Bookmark} padded>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <dt className="text-gray-500">Format</dt>
                <dd className="text-gray-950 font-medium">1080 × 1920</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Durée cible</dt>
                <dd className="text-gray-950 font-medium tabular-nums">18 s</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Créé</dt>
                <dd className="text-gray-700">il y a 3 j</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Modifié</dt>
                <dd className="text-gray-700">il y a 2 h</dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </div>
  );
}

// ─── Pattern 2 : Quick edit drawer ─────────────────────────────────────────

function QuickEditDrawerPattern() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("statut");

  const [status, setStatus] = useState("CAPTIONS_PENDING");
  const [scheduledAt, setScheduledAt] = useState("2026-06-18");
  const [scheduledTime, setScheduledTime] = useState("18:00");
  const [notifyClient, setNotifyClient] = useState(true);

  const [monteurId, setMonteurId] = useState<string | null>("u-bob");
  const [cmId, setCmId] = useState<string | null>("u-diane");

  const [overrideCover, setOverrideCover] = useState(false);
  const [overrideCaptions, setOverrideCaptions] = useState(true);
  const [overrideNotify, setOverrideNotify] = useState(false);
  const [coverPreset, setCoverPreset] = useState("story-luxe");
  const [captionsPreset, setCaptionsPreset] = useState("");

  const [duration, setDuration] = useState(18);

  return (
    <div className="rounded-2xl p-5 bg-white/40 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
      <p className="text-[12px] text-gray-600 mb-3 leading-relaxed">
        Le drawer édition rapide est ouvert depuis le calendrier ou la fiche.
        Click le bouton ci-dessous pour ouvrir.
      </p>
      <Button icon={Pencil} onClick={() => setOpen(true)}>Ouvrir l&apos;éditeur</Button>

      <Drawer open={open} onClose={() => setOpen(false)} side="right" size="lg">
        <Drawer.Header onClose={() => setOpen(false)}>
          Story carrousel #18 · @studio-paris
        </Drawer.Header>
        <Drawer.Body>
          <Tabs
            variant="line"
            items={[
              { id: "statut",      label: "Statut",      icon: CalIcon },
              { id: "assignations", label: "Assignations", icon: UserCircle2 },
              { id: "overrides",   label: "Overrides",   icon: Settings },
              { id: "planning",    label: "Planning",    icon: CalIcon },
            ]}
            value={tab}
            onChange={setTab}
            className="mb-4"
          />

          {tab === "statut" && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Statut</p>
                <Combobox
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "DRAFT", label: "Brouillon" },
                    { value: "RUSHES_EXPECTED", label: "Rushes attendus" },
                    { value: "IN_EDIT", label: "Montage en cours" },
                    { value: "CAPTIONS_PENDING", label: "Captions à faire" },
                    { value: "AWAITING_CLIENT", label: "Attente client" },
                    { value: "SCHEDULED", label: "Programmé" },
                  ]}
                />
              </div>
              <Switch
                checked={notifyClient}
                onChange={setNotifyClient}
                label="Notifier le client à la publication"
                description="Email envoyé automatiquement"
              />
            </div>
          )}

          {tab === "assignations" && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Monteur</p>
                <AssigneePicker
                  value={monteurId}
                  onChange={setMonteurId}
                  users={USERS}
                  allowedRoles={["MONTEUR"]}
                  groupByRole={false}
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">CM</p>
                <AssigneePicker
                  value={cmId}
                  onChange={setCmId}
                  users={USERS}
                  allowedRoles={["CM"]}
                  groupByRole={false}
                />
              </div>
            </div>
          )}

          {tab === "overrides" && (
            <div className="space-y-3">
              <OverrideControl
                label="Preset cover"
                description="Choix du template pour ce slot uniquement"
                inheritedValue="Hérité du pattern : Story propre"
                isOverriden={overrideCover}
                onToggleOverride={setOverrideCover}
              >
                <Combobox
                  value={coverPreset}
                  onChange={setCoverPreset}
                  placeholder="Sélectionner un preset…"
                  options={[
                    { value: "story-propre", label: "Story propre" },
                    { value: "story-luxe", label: "Story luxe" },
                    { value: "minimal", label: "Minimal sans texte" },
                  ]}
                />
              </OverrideControl>
              <OverrideControl
                label="Captions config"
                inheritedValue="Hérité : font Inter, gros, jaune"
                isOverriden={overrideCaptions}
                onToggleOverride={setOverrideCaptions}
              >
                <Combobox
                  value={captionsPreset}
                  onChange={setCaptionsPreset}
                  placeholder="Choisir un preset captions…"
                  options={[
                    { value: "default", label: "Default" },
                    { value: "small-bold", label: "Small bold" },
                    { value: "large-white", label: "Large white" },
                  ]}
                />
              </OverrideControl>
              <OverrideControl
                label="Notifier le client"
                inheritedValue="Hérité : email à publish"
                isOverriden={overrideNotify}
                onToggleOverride={setOverrideNotify}
              >
                <Switch
                  checked={false}
                  onChange={() => {}}
                  label="Email désactivé pour ce slot"
                />
              </OverrideControl>
            </div>
          )}

          {tab === "planning" && (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Date publication</p>
                <DatePicker value={scheduledAt} onChange={setScheduledAt} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Heure publication</p>
                <TimePicker value={scheduledTime} onChange={setScheduledTime} minuteStep={15} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Durée cible</p>
                <Slider value={duration} onChange={setDuration} min={5} max={90} unit="s" />
              </div>
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => { setOpen(false); toast.success("Slot mis à jour."); }}>Enregistrer</Button>
        </Drawer.Footer>
      </Drawer>
    </div>
  );
}

// ─── Pattern 3 : Listing grid ──────────────────────────────────────────────

function ListingGridPattern() {
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [showVideos, setShowVideos] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [showReady, setShowReady] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const filtered = ASSETS.filter((a) => {
    if (!showVideos && a.mimeType?.startsWith("video/")) return false;
    if (!showImages && a.mimeType?.startsWith("image/")) return false;
    if (search && !a.filename.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const activeCount = [
    search ? 1 : 0,
    account ? 1 : 0,
    showVideos ? 0 : 1,
    showImages ? 0 : 1,
    showReady ? 0 : 1,
  ].reduce((a, b) => a + b, 0);

  function reset() {
    setSearch("");
    setAccount("");
    setShowVideos(true);
    setShowImages(true);
    setShowReady(true);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <FilterBar activeCount={activeCount} onReset={reset} sticky={false}>
        <div className="w-60 shrink-0">
          <Input value={search} onChange={setSearch} placeholder="Rechercher un fichier…" icon={Eye} />
        </div>
        <div className="w-44 shrink-0">
          <Combobox
            value={account}
            onChange={setAccount}
            placeholder="Compte IG"
            options={[
              { value: "studio-paris", label: "@studio-paris" },
              { value: "luxe-immo", label: "@luxe-immo" },
            ]}
          />
        </div>
        <Chip variant="default" selected={showVideos} onClick={() => setShowVideos((v) => !v)} icon={Video}>Vidéos</Chip>
        <Chip variant="default" selected={showImages} onClick={() => setShowImages((v) => !v)}>Images</Chip>
        <Chip variant="sage" selected={showReady} onClick={() => setShowReady((v) => !v)}>Prêts</Chip>
      </FilterBar>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="rounded-xl px-4 py-2.5 bg-sky-50/60 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)] flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-sky-700">
            {selected.size} média{selected.size > 1 ? "s" : ""} sélectionné{selected.size > 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={Bookmark}>Tagguer</Button>
            <Button variant="ghost" size="sm" icon={Sparkles}>Générer cover</Button>
            <Button variant="danger" size="sm" icon={Trash2}>Supprimer</Button>
            <ButtonIcon icon={X} label="Annuler la sélection" variant="ghost" size="sm" onClick={() => setSelected(new Set())} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {pageItems.map((a) => (
          <AssetCard
            key={a.id}
            asset={a}
            variant="default"
            aspect="9:16"
            selectable
            selected={selected.has(a.id)}
            onSelect={() => toggle(a.id)}
            onPlay={() => toast.info(`Lire ${a.filename}`)}
            badges={showReady ? <StatusBadge domain="render" status="COMPLETED" size="sm" /> : undefined}
            actions={<ButtonIcon icon={MoreHorizontal} label="Plus" variant="ghost" size="sm" />}
          />
        ))}
      </div>

      <Pagination
        page={page}
        total={filtered.length}
        pageSize={pageSize}
        onPageChange={setPage}
        showRange
      />
    </div>
  );
}

// ─── Pattern 4 : Tool page ─────────────────────────────────────────────────

function ToolPagePattern() {
  const [name, setName] = useState("Captions Story Luxe");
  const [desc, setDesc] = useState("Sous-titres premium pour les comptes immobilier haut de gamme.");
  const [font, setFont] = useState("inter");
  const [activeFromDate, setActiveFromDate] = useState("2026-06-01");
  const [autoApply, setAutoApply] = useState(true);

  return (
    <SoftPanel
      maxHeight="700px"
      header={
        <div className="space-y-2">
          <Breadcrumb
            items={[
              { href: "/admin", label: "Admin", icon: <Home size={12} /> },
              { href: "/admin/libraries", label: "Ressources" },
              { href: "/admin/libraries/captions", label: "Captions presets" },
              { label: name },
            ]}
          />
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-[15px] font-semibold tracking-tight text-gray-950">
              Édition preset captions
            </h3>
            <Badge variant="info" dot>Modifié</Badge>
          </div>
        </div>
      }
      toolbar={
        <>
          <Button variant="secondary">Annuler</Button>
          <Button onClick={() => toast.success("Preset enregistré.")}>Enregistrer</Button>
        </>
      }
    >
      <div className="space-y-6 max-w-2xl">
        <Section title="Identité du preset" icon={FileText}>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Nom</p>
              <Input value={name} onChange={setName} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Description</p>
              <Textarea value={desc} onChange={setDesc} rows={3} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Font</p>
              <div className="w-60">
                <Select
                  value={font}
                  onChange={setFont}
                  options={[
                    { value: "inter", label: "Inter (default)" },
                    { value: "geist", label: "Geist Sans" },
                    { value: "instrument", label: "Instrument Serif" },
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Activation" icon={CalIcon}>
          <div className="space-y-3">
            <Switch checked={autoApply} onChange={setAutoApply} label="Appliquer automatiquement aux nouveaux slots" description="Sinon : sélection manuelle par slot" />
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Actif à partir du</p>
              <DatePicker value={activeFromDate} onChange={setActiveFromDate} />
            </div>
          </div>
        </Section>

        <Section title="Jobs en cours utilisant ce preset" icon={Settings}>
          <div className="space-y-2">
            <JobQueueItem
              job={{
                id: "j-1",
                domain: "caption",
                status: "GENERATING",
                title: "Story #18 — @studio-paris",
                description: "Whisper large-v3 · 47 mots",
                progress: 65,
                startedAt: new Date(Date.now() - 4 * 60_000),
              }}
              compact
              actions={<ButtonIcon icon={X} label="Annuler" variant="ghost" size="sm" />}
            />
            <JobQueueItem
              job={{
                id: "j-2",
                domain: "caption",
                status: "COMPLETED",
                title: "Story #14 — @luxe-immo",
                description: "Terminé",
                progress: 100,
              }}
              compact
            />
            <JobQueueItem
              job={{
                id: "j-3",
                domain: "caption",
                status: "QUEUED",
                title: "Reel #22 — @appart-lyon",
                description: "En attente",
              }}
              compact
            />
          </div>
        </Section>
      </div>
    </SoftPanel>
  );
}

// ─── Pattern 5 : Admin table ───────────────────────────────────────────────

function AdminTablePattern() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("MONTEUR");

  type UserRow = {
    id: string;
    name: string;
    email: string;
    role: string;
    lastSeen: string;
    active: boolean;
  };

  const rows: UserRow[] = [
    { id: "u-alice", name: "Alice Dubois",     email: "alice@toolbox.fr",   role: "MONTEUR",  lastSeen: "il y a 12 min", active: true  },
    { id: "u-bob",   name: "Bob Martin",       email: "bob@toolbox.fr",     role: "MONTEUR",  lastSeen: "il y a 2 h",    active: true  },
    { id: "u-clara", name: "Clara Petit",      email: "clara@toolbox.fr",   role: "MONTEUR",  lastSeen: "hier",          active: false },
    { id: "u-diane", name: "Diane Roux",       email: "diane@toolbox.fr",   role: "CM",       lastSeen: "il y a 1 h",    active: true  },
    { id: "u-eric",  name: "Eric Lambert",     email: "eric@toolbox.fr",    role: "CM",       lastSeen: "il y a 3 j",    active: true  },
    { id: "u-fabio", name: "Fabio Cinque",     email: "fabio@toolbox.fr",   role: "VIDEASTE", lastSeen: "il y a 30 min", active: true  },
    { id: "u-greg",  name: "Grégoire Vacher",  email: "greg@toolbox.fr",    role: "VIDEASTE", lastSeen: "il y a 5 j",    active: false },
    { id: "u-helen", name: "Hélène Bernard",   email: "helen@toolbox.fr",   role: "ADMIN",    lastSeen: "il y a 2 min",  active: true  },
  ];

  const filtered = rows.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (role && r.role !== role) return false;
    if (activeOnly && !r.active) return false;
    return true;
  });

  const columns: TableColumn<UserRow>[] = [
    {
      id: "name",
      label: "Nom",
      sortable: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={r.name} size="sm" />
          <span>
            <span className="block font-medium leading-tight">{r.name}</span>
            <span className="block text-[10px] text-gray-500 leading-tight">{r.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: "role",
      label: "Rôle",
      sortable: true,
      width: "120px",
      cell: (r) => (
        <Chip
          variant={r.role === "ADMIN" ? "rose" : r.role === "MONTEUR" ? "peach" : r.role === "CM" ? "sage" : "sky"}
          size="sm"
        >
          {r.role}
        </Chip>
      ),
    },
    {
      id: "active",
      label: "Actif",
      sortable: true,
      width: "100px",
      cell: (r) =>
        r.active ? (
          <Badge variant="sage" dot>Actif</Badge>
        ) : (
          <Badge variant="default" dot>Inactif</Badge>
        ),
    },
    { id: "lastSeen", label: "Dernière activité", width: "160px", cell: (r) => <span className="text-gray-700">{r.lastSeen}</span> },
  ];

  const activeCount = [search ? 1 : 0, role ? 1 : 0, activeOnly ? 1 : 0].reduce((a, b) => a + b, 0);

  function startEdit(row: UserRow) {
    setEditId(row.id);
    setEditName(row.name);
    setEditEmail(row.email);
    setEditRole(row.role);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <FilterBar
          activeCount={activeCount}
          onReset={() => { setSearch(""); setRole(""); setActiveOnly(false); }}
          sticky={false}
          className="flex-1"
        >
          <div className="w-60 shrink-0">
            <Input value={search} onChange={setSearch} placeholder="Rechercher un utilisateur…" icon={Eye} />
          </div>
          <div className="w-44 shrink-0">
            <Combobox
              value={role}
              onChange={setRole}
              placeholder="Tous les rôles"
              options={[
                { value: "ADMIN", label: "Admin" },
                { value: "MONTEUR", label: "Monteur" },
                { value: "CM", label: "CM" },
                { value: "VIDEASTE", label: "Vidéaste" },
              ]}
            />
          </div>
          <Chip variant="sage" selected={activeOnly} onClick={() => setActiveOnly((v) => !v)}>Actifs uniquement</Chip>
        </FilterBar>
        <Button icon={Plus}>Nouvel utilisateur</Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="rounded-xl px-4 py-2.5 bg-sky-50/60 backdrop-blur-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.32)] flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-sky-700">
            {selected.size} utilisateur{selected.size > 1 ? "s" : ""} sélectionné{selected.size > 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={Mail}>Envoyer un email</Button>
            <Button variant="danger" size="sm" icon={Trash2}>Désactiver</Button>
            <ButtonIcon icon={X} label="Annuler" variant="ghost" size="sm" onClick={() => setSelected(new Set())} />
          </div>
        </div>
      )}

      <Table
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        selectable
        selectedKeys={selected}
        onSelectionChange={setSelected}
        onRowClick={(r) => startEdit(r)}
      />

      <Pagination page={page} total={filtered.length} pageSize={10} onPageChange={setPage} showRange />

      {/* Modal édition */}
      <Modal open={!!editId} onClose={() => setEditId(null)} size="md">
        <Modal.Header onClose={() => setEditId(null)}>
          Éditer l&apos;utilisateur
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Nom</p>
              <Input value={editName} onChange={setEditName} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Email</p>
              <Input value={editEmail} onChange={setEditEmail} type="email" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mb-1.5">Rôle</p>
              <Select
                value={editRole}
                onChange={setEditRole}
                options={[
                  { value: "ADMIN", label: "Admin" },
                  { value: "MONTEUR", label: "Monteur" },
                  { value: "CM", label: "CM" },
                  { value: "VIDEASTE", label: "Vidéaste" },
                ]}
              />
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditId(null)}>Annuler</Button>
          <Button onClick={() => { setEditId(null); toast.success("Utilisateur mis à jour."); }}>Enregistrer</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
