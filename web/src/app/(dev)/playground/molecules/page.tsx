"use client";

/**
 * Phase 4 — Molécules métier Liquid Glass.
 *
 * Vitrine des composants composés à partir des primitives + atomes.
 * Lot 1 : Section, SoftPanel, EmptyHero, StatusBadge + lib statusMapping.
 */

import { useState } from "react";
import {
  Brush,
  Captions,
  FileText,
  Folder,
  Home,
  Image as ImageIcon,
  Layers,
  Sparkles,
  Calendar,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Switch } from "@/components/ui/Switch";

import { Section } from "@/components/ui/molecules/Section";
import { SoftPanel } from "@/components/ui/molecules/SoftPanel";
import { EmptyHero } from "@/components/ui/molecules/EmptyHero";
import { StatusBadge } from "@/components/ui/molecules/StatusBadge";
import { VideoPlayer, type CaptionLine } from "@/components/ui/molecules/VideoPlayer";
import { AssetCard } from "@/components/ui/molecules/AssetCard";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Eye, MoreHorizontal, Trash2 } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function PageSection({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
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

export default function MoleculesPage() {
  const [notifications, setNotifications] = useState(true);
  const [sectionName, setSectionName] = useState("Brief visite appartement");
  const [sectionDesc, setSectionDesc] = useState("Tournage prévu jeudi matin · réception client mardi.");

  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 4 · Molécules métier
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          Section · SoftPanel · EmptyHero · StatusBadge
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          Lot 1 — 5 unités structurelles. Wrappers (Section + SoftPanel) qui
          factorisent les patterns dupliqués dans la fiche pub et les pages
          d&apos;édition. Empty states large format pour pages vides. Status
          badges centralisés via <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">lib/ui/statusMapping.ts</code> (render / caption /
          description / cover / slot / transcription).
        </p>
      </header>

      {/* ━━━ STATUS BADGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="status-badge" eyebrow="Lot 1" title="StatusBadge">
        <Row label="Render">
          <StatusBadge domain="render" status="QUEUED" />
          <StatusBadge domain="render" status="IN_PROGRESS" />
          <StatusBadge domain="render" status="COMPLETED" />
          <StatusBadge domain="render" status="FAILED" />
        </Row>
        <Row label="Caption">
          <StatusBadge domain="caption" status="PENDING" />
          <StatusBadge domain="caption" status="GENERATING" />
          <StatusBadge domain="caption" status="READY" />
          <StatusBadge domain="caption" status="FAILED" />
        </Row>
        <Row label="Description">
          <StatusBadge domain="description" status="QUEUED" />
          <StatusBadge domain="description" status="RUNNING" />
          <StatusBadge domain="description" status="COMPLETED" />
        </Row>
        <Row label="Cover">
          <StatusBadge domain="cover" status="PENDING" />
          <StatusBadge domain="cover" status="GENERATING" />
          <StatusBadge domain="cover" status="READY" />
        </Row>
        <Row label="Transcription">
          <StatusBadge domain="transcription" status="QUEUED" />
          <StatusBadge domain="transcription" status="RUNNING" />
          <StatusBadge domain="transcription" status="COMPLETED" />
          <StatusBadge domain="transcription" status="FAILED" />
        </Row>
        <Row label="Slot (échantillon)">
          <StatusBadge domain="slot" status="DRAFT" />
          <StatusBadge domain="slot" status="IN_EDIT" />
          <StatusBadge domain="slot" status="AWAITING_CLIENT" />
          <StatusBadge domain="slot" status="SCHEDULED" />
          <StatusBadge domain="slot" status="PUBLISHED" />
          <StatusBadge domain="slot" status="REJECTED" />
        </Row>
        <Row label="Variants">
          <StatusBadge domain="render" status="IN_PROGRESS" dot />
          <StatusBadge domain="render" status="IN_PROGRESS" glass />
          <StatusBadge domain="render" status="IN_PROGRESS" hideIcon />
          <StatusBadge domain="render" status="IN_PROGRESS" size="md" />
        </Row>
        <Row label="Statut inconnu">
          <StatusBadge domain="render" status="WEIRD_STATE" />
          <span className="text-[12px] text-gray-500">Fallback : variant default + label brut</span>
        </Row>
      </PageSection>

      {/* ━━━ SECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="section" eyebrow="Lot 1" title="Section">
        <div className="space-y-4">
          {/* Section default solide */}
          <Section
            title="Section default"
            description="Solid blanc, ring inset, hover lift subtle. Le défaut pour la fiche pub."
            icon={FileText}
          >
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Corps de la section. Tout type de contenu (form, list, preview).
            </p>
          </Section>

          {/* Section avec actions */}
          <Section
            title="Brief client"
            description="Visite 3 pièces · 65 m² · vue Sacré-Cœur"
            icon={FileText}
            actions={
              <>
                <Button size="sm" variant="ghost">Voir le PDF</Button>
                <Button size="sm">Éditer</Button>
              </>
            }
          >
            <div className="space-y-3">
              <Input value={sectionName} onChange={setSectionName} placeholder="Nom du brief" />
              <Textarea value={sectionDesc} onChange={setSectionDesc} rows={3} placeholder="Notes additionnelles" />
              <Switch checked={notifications} onChange={setNotifications} label="Notifier le client" description="Email au déclenchement" />
            </div>
          </Section>

          {/* Section variant glass */}
          <Section
            variant="glass"
            title="Section glass"
            description="Surface glass-strong + ring inset signature"
            icon={Sparkles}
            actions={<StatusBadge domain="cover" status="READY" />}
          >
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Idéal pour les overlays sur fonds tintés ou les sections "moment" qui doivent ressortir.
            </p>
          </Section>

          {/* Section variant tinted × 4 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section variant="tinted" tint="peach" title="Tinted peach" icon={ImageIcon}>
              <p className="text-[12px] text-gray-700">Chaleur, statut à faire.</p>
            </Section>
            <Section variant="tinted" tint="sage" title="Tinted sage" icon={Captions}>
              <p className="text-[12px] text-gray-700">Calme, statut OK.</p>
            </Section>
            <Section variant="tinted" tint="sky" title="Tinted sky" icon={Calendar}>
              <p className="text-[12px] text-gray-700">Info, planning.</p>
            </Section>
            <Section variant="tinted" tint="rose" title="Tinted rose" icon={Sparkles}>
              <p className="text-[12px] text-gray-700">Signature rare, accent.</p>
            </Section>
          </div>

          {/* Collapsible */}
          <Section
            title="Section pliable"
            description="Click chevron pour réduire → re-click pill pour rouvrir"
            icon={Layers}
            collapsible
            defaultOpen
          >
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Le bouton chevron en haut à droite ferme la section (rendu pill glass-faint).
            </p>
          </Section>

          <Section
            title="Section initialement fermée"
            icon={Layers}
            collapsible
            defaultOpen={false}
          >
            <p className="text-[13px] text-gray-700">Click le pill pour m&apos;ouvrir.</p>
          </Section>
        </div>
      </PageSection>

      {/* ━━━ SOFT PANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="soft-panel" eyebrow="Lot 1" title="SoftPanel">
        <p className="text-[12px] text-gray-600 mb-4 leading-relaxed">
          Wrapper page intérieure pour éditeurs longs (admin/libraries/media/[id],
          builder, captions/edit). Header sticky + scroll interne + toolbar bottom.
        </p>
        <SoftPanel
          maxHeight="500px"
          header={
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Breadcrumb
                  items={[
                    { href: "/admin", label: "Admin", icon: <Home size={12} /> },
                    { href: "/admin/libraries", label: "Ressources" },
                    { href: "/admin/libraries/media", label: "Médias" },
                    { label: "Story carrousel #18" },
                  ]}
                />
                <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">
                  Édition du média
                </h2>
              </div>
              <Badge variant="info" dot>Modifié</Badge>
            </div>
          }
          toolbar={
            <>
              <Button size="sm" variant="ghost">Annuler</Button>
              <Button size="sm">Enregistrer</Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Cette page représente un éditeur long. Le header reste sticky au
              scroll de la zone interne. La toolbar bottom contient les actions
              de sauvegarde.
            </p>
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="p-3 rounded-md bg-white/40 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] text-[12px] text-gray-700">
                Ligne d&apos;exemple #{i + 1} — scroll pour voir le sticky header en action.
              </div>
            ))}
          </div>
        </SoftPanel>

        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">Sans toolbar</p>
          <SoftPanel
            maxHeight="200px"
            header={<h2 className="text-[14px] font-semibold tracking-tight text-gray-950">Aperçu rapide</h2>}
          >
            <p className="text-[13px] text-gray-700 leading-relaxed">
              SoftPanel peut être utilisé sans toolbar — juste header + content scrollable.
            </p>
          </SoftPanel>
        </div>
      </PageSection>

      {/* ━━━ EMPTY HERO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="empty-hero" eyebrow="Lot 1" title="EmptyHero">
        <p className="text-[12px] text-gray-600 mb-4 leading-relaxed">
          À distinguer d&apos;<code className="text-[11px] font-mono">EmptyState</code> (inline dans une carte) — EmptyHero remplit une page entière vide.
          Title en font-hand (signature discrète autorisée pour les "moments"), wrapper icône large avec halo signature.
        </p>

        <div className="rounded-2xl bg-white/30 backdrop-blur-[6px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
          <EmptyHero
            icon={Folder}
            title="Pas encore de listing"
            description="Démarre la création de ton premier listing pour structurer la production d'une nouvelle visite."
            cta={<Button icon={Sparkles}>Créer un listing</Button>}
            secondaryActions={<Button variant="ghost">Voir la doc</Button>}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/30 backdrop-blur-[6px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
            <EmptyHero
              padding="md"
              icon={Brush}
              title="Captions à venir"
              description="Cette section accueillera bientôt les sous-titres générés."
            />
          </div>
          <div className="rounded-2xl bg-white/30 backdrop-blur-[6px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
            <EmptyHero
              padding="md"
              icon={Sparkles}
              title="Tout est à jour"
              description="Aucune action en attente — profite du calme."
            />
          </div>
        </div>
      </PageSection>

      {/* ━━━ VIDEO PLAYER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="video-player" eyebrow="Lot 2 · Média" title="VideoPlayer">
        <p className="text-[12px] text-gray-600 mb-4 leading-relaxed">
          5 variants — démos avec Big Buck Bunny sample (CDN public). Aspect
          9:16 par défaut (format story IG). Chrome bottom glass + play button
          center FAB glass-strong avec halo signature.
        </p>
        <VideoPlayerShowcase />
      </PageSection>

      {/* ━━━ ASSET CARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <PageSection id="asset-card" eyebrow="Lot 2 · Média" title="AssetCard">
        <AssetCardShowcase />
      </PageSection>

      {/* Note pied de page */}
      <div className="surface-glass-soft rounded-xl p-5 mt-12">
        <p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mb-2">
          Lots restants Phase 4
        </p>
        <p className="text-[13px] text-gray-700 leading-relaxed">
          Lot 3 (Édition) → TrimPlayer, OverrideControl, AssigneePicker ·
          Lot 4 (Métier) → FilterBar, JobQueueItem
        </p>
      </div>
    </div>
  );
}

// ─── Showcase VideoPlayer ──────────────────────────────────────────────────

const SAMPLE_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
const SAMPLE_POSTER = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg";

const SAMPLE_CAPTIONS: CaptionLine[] = [
  { start: 0,  end: 3,  text: "Bienvenue dans cette visite." },
  { start: 3,  end: 6,  text: "Vue panoramique sur Paris depuis le toit." },
  { start: 6,  end: 10, text: "Cuisine ouverte 25 m² + îlot central." },
  { start: 10, end: 14, text: "Vidéo de démo cmdk Big Buck Bunny." },
  { start: 14, end: 20, text: "Toutes les captions sont animées en temps réel." },
];

function VideoPlayerShowcase() {
  return (
    <>
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="minimal" · aspect 9:16 (story)</p>
        <div className="w-48"><VideoPlayer src={SAMPLE_VIDEO} poster={SAMPLE_POSTER} variant="minimal" aspect="9:16" /></div>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="minimal" · aspect 16:9</p>
        <div className="max-w-2xl"><VideoPlayer src={SAMPLE_VIDEO} poster={SAMPLE_POSTER} variant="minimal" aspect="16:9" /></div>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="captions" · captions inline animées</p>
        <div className="max-w-2xl"><VideoPlayer src={SAMPLE_VIDEO} poster={SAMPLE_POSTER} variant="captions" aspect="16:9" captions={SAMPLE_CAPTIONS} /></div>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="trim" · dual-range trimmer</p>
        <div className="max-w-2xl">
          <VideoPlayer
            src={SAMPLE_VIDEO}
            poster={SAMPLE_POSTER}
            variant="trim"
            aspect="16:9"
            trimStart={2}
            trimEnd={8}
          />
        </div>
        <p className="text-[11px] text-gray-500">Dual-range avec handles ronds glass — la lecture clamp entre trim start/end.</p>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="fullscreen" · chrome étendu (volume + plein écran)</p>
        <div className="max-w-2xl"><VideoPlayer src={SAMPLE_VIDEO} poster={SAMPLE_POSTER} variant="fullscreen" aspect="16:9" /></div>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="native" · controls HTML natifs (debug)</p>
        <div className="max-w-md"><VideoPlayer src={SAMPLE_VIDEO} poster={SAMPLE_POSTER} variant="native" aspect="16:9" /></div>
      </div>
    </>
  );
}

// ─── Showcase AssetCard ────────────────────────────────────────────────────

function AssetCardShowcase() {
  const [selected, setSelected] = useState<Set<string>>(new Set(["asset-2"]));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const assets = [
    {
      id: "asset-1",
      url: SAMPLE_VIDEO,
      filename: "rooftop-paris-final.mp4",
      duration: 18,
      thumbnail: "https://picsum.photos/seed/paris1/400/600",
      mimeType: "video/mp4",
    },
    {
      id: "asset-2",
      url: SAMPLE_VIDEO,
      filename: "cuisine-ouverte-v3.mp4",
      duration: 24,
      thumbnail: "https://picsum.photos/seed/cuisine/400/600",
      mimeType: "video/mp4",
    },
    {
      id: "asset-3",
      url: SAMPLE_VIDEO,
      filename: "salon-vue-final.mp4",
      duration: 42,
      thumbnail: "https://picsum.photos/seed/salon/400/600",
      mimeType: "video/mp4",
    },
    {
      id: "asset-4",
      url: "https://picsum.photos/seed/cover1/800/800",
      filename: "cover-v2.jpg",
      thumbnail: "https://picsum.photos/seed/cover1/400/400",
      mimeType: "image/jpeg",
    },
  ];

  return (
    <>
      {/* Compact */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="compact" · liste dense</p>
        <div className="space-y-1.5 max-w-2xl">
          {assets.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              variant="compact"
              selectable
              selected={selected.has(a.id)}
              onSelect={() => toggle(a.id)}
              onPlay={() => {}}
              actions={
                <>
                  <ButtonIcon icon={Eye} label="Voir" variant="ghost" size="sm" />
                  <ButtonIcon icon={MoreHorizontal} label="Plus" variant="ghost" size="sm" />
                </>
              }
              badges={
                a.mimeType?.startsWith("video/") ? (
                  <StatusBadge domain="render" status="COMPLETED" hideIcon size="sm" />
                ) : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* Default grid 9:16 */}
      <div className="mt-8 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="default" · grid 9:16</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-w-3xl">
          {assets.slice(0, 4).map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              variant="default"
              aspect="9:16"
              selectable
              selected={selected.has(a.id)}
              onSelect={() => toggle(a.id)}
              onPlay={() => {}}
              badges={<StatusBadge domain="render" status="COMPLETED" size="sm" />}
              actions={
                <>
                  <ButtonIcon icon={MoreHorizontal} label="Plus" variant="ghost" size="sm" />
                </>
              }
            />
          ))}
        </div>
      </div>

      {/* Default grid 1:1 */}
      <div className="mt-8 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="default" · aspect 1:1 (cover)</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl">
          {assets.slice(0, 3).map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              variant="default"
              aspect="1:1"
              onPlay={() => {}}
            />
          ))}
        </div>
      </div>

      {/* Expanded */}
      <div className="mt-8 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">variant="expanded" · preview vidéo inline + metadata détaillé</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          <AssetCard
            asset={{
              ...assets[0],
              metadata: {
                "Importé": "Hier, 14h32",
                "Compte": "@studio-paris",
                "Format": "1920×1080",
                "Codec": "H.264",
              },
            }}
            variant="expanded"
            aspect="16:9"
            selected={selected.has(assets[0].id)}
            selectable
            onSelect={() => toggle(assets[0].id)}
            badges={
              <>
                <StatusBadge domain="render" status="COMPLETED" />
                <StatusBadge domain="caption" status="GENERATING" />
              </>
            }
            actions={
              <>
                <ButtonIcon icon={Eye} label="Aperçu" variant="secondary" size="sm" />
                <ButtonIcon icon={Trash2} label="Supprimer" variant="danger" size="sm" />
              </>
            }
          />
          <AssetCard
            asset={{
              ...assets[1],
              metadata: {
                "Slot": "Story #18",
                "Statut": "Validé",
                "Durée": "24 s",
              },
            }}
            variant="expanded"
            aspect="9:16"
            selectable
            badges={<StatusBadge domain="slot" status="PUBLISHED" />}
          />
        </div>
      </div>
    </>
  );
}
