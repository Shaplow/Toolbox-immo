"use client";

/**
 * Atoms — vitrine des 22 primitives avec variants Liquid Glass (Phase 2).
 *
 * Validation visuelle pour Mathis. Chaque section affiche le défaut +
 * les nouveaux variants côte à côte. Les primitives interactives
 * (DropdownMenu, ConfirmDialog, Toast, MediaDropzone) sont câblées
 * pour pouvoir cliquer dessus.
 */

import { useState } from "react";
import { ArrowRight, Bookmark, Check, Copy, Download, Eye, MoreHorizontal, Plus, Search, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Kbd, KbdChord } from "@/components/ui/Kbd";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { toast } from "@/components/ui/Toast";

// ─── Helpers locaux ─────────────────────────────────────────────────────────

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-20">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">{eyebrow}</p>
        <h2 className="text-xl font-semibold tracking-tight text-gray-950">{title}</h2>
      </header>
      <div className="surface-glass-soft rounded-xl p-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-6 py-3 border-b border-white/30 last:border-b-0">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-widest font-medium text-gray-500 pt-2">{label}</span>
      <div className="flex-1 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AtomsPage() {
  const [tab, setTab] = useState("a");
  const [pillTab, setPillTab] = useState("all");
  const [glassTab, setGlassTab] = useState("now");
  const [sw1, setSw1] = useState(true);
  const [sw2, setSw2] = useState(true);
  const [slider1, setSlider1] = useState(40);
  const [slider2, setSlider2] = useState(65);
  const [slider3, setSlider3] = useState(30);
  const [slider4, setSlider4] = useState(80);
  const [inputV, setInputV] = useState("");
  const [glassInputV, setGlassInputV] = useState("");
  const [textareaV, setTextareaV] = useState("");
  const [glassTextareaV, setGlassTextareaV] = useState("");
  const [selectV, setSelectV] = useState("opt1");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 2 · Atoms
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          22 primitives — Liquid Glass
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          Chaque primitive a gagné un variant <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">glass</code> ou <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">tinted</code> opt-in
          (Phase 2A). Les overlays (Tooltip, DropdownMenu, ConfirmDialog, Toast) ont
          migré leur défaut vers Liquid Glass (Phase 2B). Cette page sert de
          validation visuelle avant Phase 3.
        </p>
      </header>

      {/* ━━━ ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="button" eyebrow="Actions" title="Button">
        <Row label="Default">
          <Button variant="primary" icon={Plus}>Primary</Button>
          <Button variant="secondary" icon={Eye}>Secondary</Button>
          <Button variant="ghost" icon={Copy}>Ghost</Button>
          <Button variant="danger" icon={Trash2}>Danger</Button>
        </Row>
        <Row label="Glass v2">
          <Button variant="glass" icon={Bookmark}>Glass</Button>
          <Button variant="softPrimary" icon={Zap}>Soft primary</Button>
        </Row>
        <Row label="Sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row label="States">
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button icon={ArrowRight} iconRight>Continuer</Button>
        </Row>
      </Section>

      <Section id="button-icon" eyebrow="Actions" title="ButtonIcon">
        <Row label="Variants">
          <ButtonIcon icon={Plus} label="Ajouter" variant="primary" />
          <ButtonIcon icon={Eye} label="Voir" variant="secondary" />
          <ButtonIcon icon={Copy} label="Copier" variant="ghost" />
          <ButtonIcon icon={Trash2} label="Supprimer" variant="danger" />
          <ButtonIcon icon={Bookmark} label="Glass" variant="glass" />
        </Row>
        <Row label="Floating (FAB)">
          <ButtonIcon icon={Plus} label="Nouvel élément" floating />
          <ButtonIcon icon={Download} label="Télécharger" floating size="sm" />
        </Row>
      </Section>

      <Section id="dropdown-menu" eyebrow="Actions" title="DropdownMenu">
        <Row label="Migration interne">
          <DropdownMenu
            trigger={<ButtonIcon icon={MoreHorizontal} label="Menu" />}
            items={[
              { label: "Voir détails", icon: Eye, onClick: () => {} },
              { label: "Copier", icon: Copy, onClick: () => {}, kbd: "⌘C" },
              { label: "Télécharger", icon: Download, onClick: () => {} },
              "separator",
              { label: "Supprimer", icon: Trash2, destructive: true, onClick: () => {} },
            ]}
          />
          <span className="text-[12px] text-gray-500">Click → panel passe en surface-glass-strong + shadow-glass-popover.</span>
        </Row>
      </Section>

      {/* ━━━ FORMS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="input" eyebrow="Forms" title="Input">
        <Row label="Default">
          <div className="w-72">
            <Input value={inputV} onChange={setInputV} placeholder="Rechercher…" icon={Search} />
          </div>
        </Row>
        <Row label="Glass v2">
          <div className="w-72">
            <Input value={glassInputV} onChange={setGlassInputV} placeholder="Rechercher…" icon={Search} variant="glass" />
          </div>
          <span className="text-[12px] text-gray-500">Halo sky au focus</span>
        </Row>
        <Row label="States">
          <div className="w-72">
            <Input value="invalid@" onChange={() => {}} error="Email invalide" icon={Search} />
          </div>
          <div className="w-44">
            <Input value="" onChange={() => {}} disabled placeholder="Disabled" />
          </div>
        </Row>
      </Section>

      <Section id="textarea" eyebrow="Forms" title="Textarea">
        <Row label="Default">
          <div className="w-96">
            <Textarea value={textareaV} onChange={setTextareaV} placeholder="Description…" rows={3} />
          </div>
        </Row>
        <Row label="Glass v2">
          <div className="w-96">
            <Textarea value={glassTextareaV} onChange={setGlassTextareaV} placeholder="Description…" rows={3} variant="glass" />
          </div>
        </Row>
      </Section>

      <Section id="select" eyebrow="Forms" title="Select">
        <Row label="Default">
          <div className="w-72">
            <Select
              value={selectV}
              onChange={setSelectV}
              options={[
                { value: "opt1", label: "Option 1" },
                { value: "opt2", label: "Option 2" },
                { value: "opt3", label: "Option 3" },
              ]}
            />
          </div>
        </Row>
        <Row label="Glass v2">
          <div className="w-72">
            <Select
              value={selectV}
              onChange={setSelectV}
              variant="glass"
              options={[
                { value: "opt1", label: "Option 1" },
                { value: "opt2", label: "Option 2" },
                { value: "opt3", label: "Option 3" },
              ]}
            />
          </div>
        </Row>
      </Section>

      <Section id="switch" eyebrow="Forms" title="Switch">
        <Row label="Default">
          <Switch checked={sw1} onChange={setSw1} label="Notifications" description="Recevoir les alertes" />
        </Row>
        <Row label="Accent sage">
          <Switch checked={sw2} onChange={setSw2} accent="sage" label="Opt-in calme" description="Track on en sage doux" />
        </Row>
      </Section>

      <Section id="slider" eyebrow="Forms" title="Slider">
        <Row label="Default">
          <div className="w-80">
            <Slider label="Volume" value={slider1} onChange={setSlider1} min={0} max={100} unit="%" />
          </div>
        </Row>
        <Row label="Accent peach">
          <div className="w-80">
            <Slider label="Chaleur" value={slider2} onChange={setSlider2} min={0} max={100} unit="%" accent="peach" />
          </div>
        </Row>
        <Row label="Accent sage">
          <div className="w-80">
            <Slider label="Calme" value={slider3} onChange={setSlider3} min={0} max={100} unit="%" accent="sage" />
          </div>
        </Row>
        <Row label="Accent sky">
          <div className="w-80">
            <Slider label="Info" value={slider4} onChange={setSlider4} min={0} max={100} unit="%" accent="sky" />
          </div>
        </Row>
      </Section>

      {/* ━━━ FEEDBACK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="toast" eyebrow="Feedback" title="Toast">
        <Row label="Trigger">
          <Button variant="secondary" size="sm" onClick={() => toast.success("Slot publié.")}>
            Trigger success
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast.error("Échec du publish.")}>
            Trigger error
          </Button>
          <Button variant="secondary" size="sm" onClick={() => toast.info("Synchronisation en cours…")}>
            Trigger info
          </Button>
        </Row>
        <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
          Le toast apparaît en bas à droite. Surface glass-popover + accent gauche
          pastel (sage / rose / sky) selon type.
        </p>
      </Section>

      <Section id="empty-state" eyebrow="Feedback" title="EmptyState">
        <EmptyState
          icon={Search}
          title="Aucun résultat"
          description="Essaie de relâcher tes filtres ou de chercher un autre mot-clé."
          cta={{ label: "Réinitialiser", onClick: () => {} }}
        />
      </Section>

      <Section id="skeleton" eyebrow="Feedback" title="Skeleton">
        <Row label="Lines">
          <div className="w-80 space-y-2">
            <Skeleton className="w-1/2" />
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/3" />
          </div>
        </Row>
        <Row label="Row">
          <div className="w-80"><SkeletonRow /></div>
        </Row>
        <Row label="Block / circle">
          <Skeleton shape="block" className="w-20 h-20" />
          <Skeleton shape="circle" className="w-12 h-12" />
        </Row>
      </Section>

      <Section id="tooltip" eyebrow="Feedback" title="Tooltip">
        <Row label="Migration interne">
          <Tooltip content="Raccourci · ⌘K"><Button variant="secondary" size="sm">Hover me</Button></Tooltip>
          <Tooltip content="Action discrète"><ButtonIcon icon={Copy} label="Copier" /></Tooltip>
          <span className="text-[12px] text-gray-500">Look macOS Sequoia : noir 90 % + backdrop-blur + ring inset.</span>
        </Row>
      </Section>

      {/* ━━━ OVERLAYS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="confirm-dialog" eyebrow="Overlays" title="ConfirmDialog">
        <Row label="Trigger">
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmOpen(true)}>
            Supprimer cet élément
          </Button>
        </Row>
        <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
          Backdrop scrim-dark + backdrop-blur 4 px. Panel surface-glass-strong +
          shadow-glass-lg. ESC ou click backdrop ferme.
        </p>
        <ConfirmDialog
          open={confirmOpen}
          variant="danger"
          title="Supprimer cet élément ?"
          description="Cette action est irréversible. Tu ne pourras pas récupérer l'élément."
          confirmLabel="Supprimer"
          onConfirm={() => {
            toast.success("Élément supprimé.");
            setConfirmOpen(false);
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      </Section>

      <Section id="dropzone" eyebrow="Overlays" title="MediaDropzone">
        <p className="text-[12px] text-gray-600 mb-3 leading-relaxed">
          Composant complet câblé sur l'API publications — non démontrable hors
          contexte. Le visuel : surface-glass-soft au repos, gradient aurora +
          shadow-glass au hover/dragover.
        </p>
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-[var(--surface-glass-soft)] backdrop-blur-[8px] px-6 py-8 text-center">
          <p className="text-[13px] font-medium text-gray-950">Aperçu zone de dépôt</p>
          <p className="text-[11px] text-gray-500 mt-0.5">surface-glass-soft + backdrop-blur 8 px</p>
        </div>
      </Section>

      {/* ━━━ DATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="badge" eyebrow="Data" title="Badge">
        <Row label="Sémantiques">
          <Badge>Default</Badge>
          <Badge variant="success" icon={Check}>Publié</Badge>
          <Badge variant="danger">Refusé</Badge>
          <Badge variant="info">Programmé</Badge>
        </Row>
        <Row label="Pastels (Coastal)">
          <Badge variant="peach" dot>Peach</Badge>
          <Badge variant="sage" dot>Sage</Badge>
          <Badge variant="sky" dot>Sky</Badge>
          <Badge variant="rose" dot>Rose-dust</Badge>
        </Row>
        <Row label="Option glass">
          <Badge variant="default" glass>Default</Badge>
          <Badge variant="success" glass dot>Publié</Badge>
          <Badge variant="peach" glass dot>Peach</Badge>
          <Badge variant="sage" glass dot>Sage</Badge>
        </Row>
        <Row label="Sizes">
          <Badge size="sm">Small</Badge>
          <Badge size="md">Medium</Badge>
        </Row>
      </Section>

      <Section id="card" eyebrow="Data" title="Card">
        <Row label="Variants">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            <Card variant="solid">
              <CardHeader title="Solid" />
              <p className="text-[12px] text-gray-600 mt-3">Défaut white + border gray-200. Inchangé.</p>
            </Card>
            <Card variant="glass" border={false}>
              <CardHeader title="Glass" borderless />
              <p className="text-[12px] text-gray-700 mt-3">Surface-glass-strong + backdrop-blur 20 px + ring inset.</p>
            </Card>
            <Card variant="frosted" border={false}>
              <CardHeader title="Frosted" borderless />
              <p className="text-[12px] text-gray-700 mt-3">Gradient frosted blanc + backdrop-blur + ring edge.</p>
            </Card>
            <Card variant="tinted" tint="peach">
              <CardHeader title="Tinted peach" />
              <p className="text-[12px] text-gray-700 mt-3">bg-peach-50 + border peach-100. Tinted sage / sky / rose disponibles.</p>
            </Card>
          </div>
        </Row>
        <Row label="Glass × tint">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            {(["peach", "sage", "sky", "rose"] as const).map((t) => (
              <Card key={t} variant="glass" tint={t} border={false}>
                <CardHeader title={`Glass ${t}`} borderless />
                <p className="text-[12px] text-gray-700 mt-3">Glass + wash {t} subtle.</p>
              </Card>
            ))}
          </div>
        </Row>
        <Row label="Interactive">
          <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
            <Card interactive>
              <p className="text-[12px] text-gray-700">Solid · hover lift</p>
            </Card>
            <Card interactive variant="glass" border={false}>
              <p className="text-[12px] text-gray-700">Glass · hover shadow-glass-md</p>
            </Card>
          </div>
        </Row>
      </Section>

      <Section id="tabs" eyebrow="Data" title="Tabs">
        <Row label="Line (default)">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: "a", label: "Aperçu" },
              { id: "b", label: "Versions", badge: <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">3</span> },
              { id: "c", label: "Activité" },
            ]}
          />
        </Row>
        <Row label="Pill">
          <Tabs
            variant="pill"
            value={pillTab}
            onChange={setPillTab}
            items={[
              { id: "all", label: "Tous" },
              { id: "active", label: "Actifs" },
              { id: "archived", label: "Archivés" },
            ]}
          />
        </Row>
        <Row label="Glass v2">
          <Tabs
            variant="glass"
            value={glassTab}
            onChange={setGlassTab}
            items={[
              { id: "now", label: "Maintenant" },
              { id: "week", label: "Semaine" },
              { id: "month", label: "Mois" },
            ]}
          />
        </Row>
      </Section>

      <Section id="kbd" eyebrow="Data" title="Kbd">
        <Row label="Migration interne">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <KbdChord keys={["⌘", "Shift", "P"]} />
          <span className="text-[12px] text-gray-500">Verre transparent + ring inset signature.</span>
        </Row>
      </Section>

      <Section id="collapsible" eyebrow="Data" title="CollapsibleSection">
        <CollapsibleSection title="Une section pliable" defaultOpen={false}>
          <div className="px-5 py-4 rounded-2xl bg-white/60 backdrop-blur-[8px] shadow-[var(--ring-glass-edge)]">
            <p className="text-[13px] text-gray-700">Contenu de la section. Le pill fermé passe en surface-glass-faint + backdrop-blur.</p>
          </div>
        </CollapsibleSection>
        <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
          Sticky-header-au-scroll prévu Phase 6 (nécessite IntersectionObserver).
        </p>
      </Section>

      {/* Note pied de page */}
      <div className="surface-glass-soft rounded-xl p-5 mt-12">
        <p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mb-2">
          Phases suivantes
        </p>
        <p className="text-[13px] text-gray-700 leading-relaxed">
          Phase 3 → 16 atomes nouveaux (Modal, Drawer, Sheet, Avatar, Alert,
          Progress, Combobox, Chip, Breadcrumb, Stepper, CommandPalette, Table,
          Pagination, DatePicker, TimePicker, NumberStepper). Phase 4 → 11
          molécules métier (VideoPlayer, AssetCard, Section, etc.).
        </p>
      </div>
    </div>
  );
}
