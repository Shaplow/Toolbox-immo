"use client";

/**
 * Phase 5 · Lot 3 — Vibes (showcase brut).
 *
 * "Tu peux montrer ça à un investisseur ?" — go/no-go DA Liquid Glass.
 *
 * 4 mises en scène extrêmes qui poussent la matière au max sans contrainte
 * fonctionnelle.
 */

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Calendar,
  ChevronRight,
  Eye,
  FileText,
  Heart,
  MoreHorizontal,
  Play,
  Plus,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Badge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Progress } from "@/components/ui/Progress";
import { Avatar, AvatarGroup } from "@/components/ui/Avatar";
import { Stepper, type Step } from "@/components/ui/Stepper";
import { StatusBadge } from "@/components/ui/molecules/StatusBadge";
import { JobQueueItem } from "@/components/ui/molecules/JobQueueItem";
import { AssetCard } from "@/components/ui/molecules/AssetCard";
import { EmptyHero } from "@/components/ui/molecules/EmptyHero";

// ─── Helpers ────────────────────────────────────────────────────────────────

const SAMPLE_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const ASSETS = Array.from({ length: 12 }, (_, i) => ({
  id: `v-${i + 1}`,
  url: SAMPLE_VIDEO,
  filename: [
    "rooftop-paris-final.mp4",
    "cuisine-ouverte-v3.mp4",
    "salon-vue-final.mp4",
    "chambre-luxe.mp4",
    "balcon-mer.mp4",
    "loft-industriel.mp4",
    "duplex-design.mp4",
    "terrasse-jardin.mp4",
    "cover-hero.jpg",
    "cover-night.jpg",
    "hero-immersion.mp4",
    "story-final.mp4",
  ][i],
  duration: [18, 24, 42, 30, 15, 22, 35, 27, undefined, undefined, 50, 19][i],
  thumbnail: `https://picsum.photos/seed/vibe-${i + 1}/400/600`,
  mimeType: i === 8 || i === 9 ? "image/jpeg" : "video/mp4",
}));

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VibesPage() {
  return (
    <div className="space-y-24">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 5 · Lot 3 · Vibes
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          Showcase brut — wow factor
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          4 mises en scène extrêmes qui poussent la matière Liquid Glass au
          max. Test ultime : <em>&quot;tu peux montrer ça à un investisseur ?&quot;</em>.
          Si oui → go pour Phase 6 (refonte modules métier).
        </p>
      </header>

      <section id="hero-landing" className="scroll-mt-20">
        <Eyebrow>Vibe 1 · Landing</Eyebrow>
        <HeroLanding />
      </section>

      <section id="control-center" className="scroll-mt-20">
        <Eyebrow>Vibe 2 · Dashboard</Eyebrow>
        <ControlCenter />
      </section>

      <section id="gallery" className="scroll-mt-20">
        <Eyebrow>Vibe 3 · Gallery</Eyebrow>
        <GalleryMasonry />
      </section>

      <section id="empty-hero-signature" className="scroll-mt-20">
        <Eyebrow>Vibe 4 · Empty signature</Eyebrow>
        <EmptyHeroSignature />
      </section>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500 mb-4">
      {children}
    </p>
  );
}

// ─── Vibe 1 : Hero landing ─────────────────────────────────────────────────

function HeroLanding() {
  return (
    <div
      className="relative rounded-3xl overflow-hidden p-12 md:p-20"
      style={{
        background: "linear-gradient(135deg, #ffe6d0 0%, #f7dde2 35%, #d4e8f3 70%, #dceee0 100%)",
      }}
    >
      {/* Décors signature flottants en background */}
      <div
        className="absolute top-12 right-12 h-64 w-64 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, #f59e6b 0%, transparent 70%)" }}
        aria-hidden
      />
      <div
        className="absolute bottom-20 left-12 h-48 w-48 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, #4d96bf 0%, transparent 70%)" }}
        aria-hidden
      />

      {/* Glass card flottante top-right */}
      <div className="absolute top-8 right-8 hidden md:block">
        <div className="px-3 py-1.5 rounded-full bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[20px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-8px_rgba(15,23,42,0.18)] inline-flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
          <span className="text-[11px] font-medium text-gray-700">12 équipes l&apos;utilisent en production</span>
        </div>
      </div>

      {/* Content */}
      <div className="relative max-w-3xl">
        <Chip variant="peach" size="md" icon={Sparkles}>Liquid Glass v2 · 2026</Chip>

        <h2 className="mt-6 text-[44px] md:text-[64px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
          La production sociale, <span className="font-hand text-peach-700">chirurgicale</span> et belle.
        </h2>

        <p className="mt-6 text-[15px] md:text-[17px] text-gray-700 leading-relaxed max-w-xl">
          Toolbox réunit le brief client, le montage, les sous-titres et la
          publication dans un seul pipeline. Glass sobre, density Linear,
          micro-interactions qui s&apos;effacent.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" icon={ArrowRight} iconRight>Démarrer un essai</Button>
          <Button size="lg" variant="glass" icon={Play}>Voir le pitch (2 min)</Button>
        </div>

        {/* Floating glass card avec preview job */}
        <div className="mt-12 max-w-md p-4 rounded-2xl bg-gradient-to-b from-white/80 to-white/50 backdrop-blur-[24px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.12),0_32px_72px_-12px_rgba(15,23,42,0.22)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Avatar name="Studio Paris" size="sm" />
              <div>
                <p className="text-[12px] font-semibold text-gray-950 leading-tight">@studio-paris</p>
                <p className="text-[10px] text-gray-500 leading-tight">il y a 2 min</p>
              </div>
            </div>
            <StatusBadge domain="render" status="IN_PROGRESS" size="sm" />
          </div>
          <p className="text-[13px] font-medium text-gray-950 mb-2 leading-tight">
            Story carrousel #18 — Rooftop Paris
          </p>
          <Progress value={73} accent="sky" showValue />
          <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500">
            <span>Rendu H.265 · 1080×1920</span>
            <span className="tabular-nums">2 min 14 restants</span>
          </div>
        </div>
      </div>

      {/* Stats row en bas */}
      <div className="relative mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl">
        {[
          { value: "47k", label: "Vidéos générées" },
          { value: "12 équipes", label: "Active prod" },
          { value: "98 %", label: "Uptime 30 jours" },
          { value: "3 s", label: "Time-to-first-render" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="px-4 py-3 rounded-xl bg-white/45 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
          >
            <p className="text-[22px] font-semibold tracking-tight text-gray-950 tabular-nums leading-none">{stat.value}</p>
            <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Vibe 2 : Control center ───────────────────────────────────────────────

function ControlCenter() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="rounded-3xl p-6 md:p-8"
      style={{
        background: "var(--gradient-page-shell)",
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">Control center</p>
          <h3 className="text-2xl font-semibold tracking-tight text-gray-950 mt-1">
            Production en temps réel
          </h3>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/55 backdrop-blur-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sage-500 shadow-[0_0_8px_rgba(111,162,128,0.6)] animate-pulse" />
          <span className="text-[11px] font-mono text-gray-700 tabular-nums">
            {time.toLocaleTimeString("fr-FR")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Stats cards */}
        {[
          { icon: Video,       label: "Rendus en file",  value: "14", trend: "+3",   variant: "sky"   as const },
          { icon: TrendingUp,  label: "Publiés 7 j",      value: "127", trend: "+18 %", variant: "sage"  as const },
          { icon: Zap,         label: "Temps moyen",     value: "2.4 m", trend: "-12 s", variant: "peach" as const },
        ].map((s) => {
          const I = s.icon;
          return (
            <div
              key={s.label}
              className="p-5 rounded-2xl bg-gradient-to-b from-white/75 to-white/50 backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-${s.variant}-100/80 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1)] text-${s.variant}-700`}>
                  <I size={16} />
                </div>
                <Chip variant={s.variant} size="sm">{s.trend}</Chip>
              </div>
              <p className="text-[28px] font-semibold tracking-tight text-gray-950 leading-none tabular-nums">{s.value}</p>
              <p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mt-1.5">{s.label}</p>
            </div>
          );
        })}

        {/* Active jobs card */}
        <div className="md:col-span-2 p-5 rounded-2xl bg-gradient-to-b from-white/75 to-white/50 backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold tracking-tight text-gray-950">Jobs actifs</p>
            <Badge variant="info" dot>4 en cours</Badge>
          </div>
          <div className="space-y-2">
            <JobQueueItem
              job={{
                id: "ac-1",
                domain: "render",
                status: "IN_PROGRESS",
                title: "Story #18 — @studio-paris",
                description: "NVENC H.265 · 1080×1920",
                progress: 73,
              }}
              compact
            />
            <JobQueueItem
              job={{
                id: "ac-2",
                domain: "caption",
                status: "GENERATING",
                title: "Captions @luxe-immo",
                description: "Whisper large-v3",
                progress: 42,
              }}
              compact
            />
            <JobQueueItem
              job={{
                id: "ac-3",
                domain: "cover",
                status: "GENERATING",
                title: "Cover #14",
                progress: 88,
              }}
              compact
            />
          </div>
        </div>

        {/* Team online card */}
        <div className="p-5 rounded-2xl bg-gradient-to-b from-white/75 to-white/50 backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] font-semibold tracking-tight text-gray-950">Équipe</p>
            <Chip variant="sage" size="sm" icon={Users}>5 en ligne</Chip>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <AvatarGroup
              avatars={[
                { id: "u1", name: "Alice", status: "online" },
                { id: "u2", name: "Bob",   status: "online" },
                { id: "u3", name: "Camille", status: "away" },
                { id: "u4", name: "Diane", status: "online" },
                { id: "u5", name: "Eric",  status: "online" },
                { id: "u6", name: "Fabio", status: "online" },
                { id: "u7", name: "Greg",  status: "offline" },
              ]}
              max={5}
              size="md"
            />
          </div>
          <div className="space-y-1.5 text-[11px] text-gray-600">
            <div className="flex justify-between">
              <span>Alice Dubois</span>
              <span className="text-gray-400">monte #18</span>
            </div>
            <div className="flex justify-between">
              <span>Bob Martin</span>
              <span className="text-gray-400">review @luxe-immo</span>
            </div>
            <div className="flex justify-between">
              <span>Diane Roux</span>
              <span className="text-gray-400">caption batch</span>
            </div>
          </div>
        </div>

        {/* Pipeline progression card */}
        <div className="md:col-span-3 p-5 rounded-2xl bg-gradient-to-b from-white/75 to-white/50 backdrop-blur-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[13px] font-semibold tracking-tight text-gray-950">Pipeline Story #18</p>
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 mt-0.5">Suivi temps réel</p>
            </div>
            <Button size="sm" variant="ghost" icon={ChevronRight} iconRight>Ouvrir fiche</Button>
          </div>
          <Stepper
            variant="linear"
            steps={[
              { id: "1", label: "Brief",    description: "Reçu, validé" },
              { id: "2", label: "Rushes",   description: "8 clips" },
              { id: "3", label: "Montage",  description: "v2 approuvé" },
              { id: "4", label: "Captions", description: "Whisper en cours" },
              { id: "5", label: "Cover",    description: "Génération" },
              { id: "6", label: "Publish",  description: "Demain 18 h" },
            ]}
            active="4"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Vibe 3 : Gallery masonry ──────────────────────────────────────────────

function GalleryMasonry() {
  const [filter, setFilter] = useState<"all" | "videos" | "covers">("all");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-2xl font-semibold tracking-tight text-gray-950">
          Médiathèque · @studio-paris
        </h3>
        <div className="flex items-center gap-2">
          <Chip variant="default" selected={filter === "all"} onClick={() => setFilter("all")}>Tous</Chip>
          <Chip variant="sky" selected={filter === "videos"} onClick={() => setFilter("videos")} icon={Video}>Vidéos</Chip>
          <Chip variant="peach" selected={filter === "covers"} onClick={() => setFilter("covers")}>Covers</Chip>
        </div>
      </div>

      {/* Featured row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <AssetCard
            asset={{
              ...ASSETS[0],
              metadata: {
                "Compte": "@studio-paris",
                "Slot": "Story carrousel #18",
                "Format": "1920×1080",
                "Importé": "Hier 14 h",
              },
            }}
            variant="expanded"
            aspect="16:9"
            badges={
              <>
                <StatusBadge domain="render" status="COMPLETED" />
                <StatusBadge domain="caption" status="GENERATING" />
              </>
            }
            actions={
              <>
                <Button size="sm" variant="secondary" icon={Eye}>Aperçu</Button>
                <ButtonIcon icon={Heart} label="Favori" variant="ghost" size="sm" />
              </>
            }
          />
        </div>
        <div className="space-y-3">
          <AssetCard
            asset={ASSETS[1]}
            variant="default"
            aspect="1:1"
            badges={<StatusBadge domain="render" status="COMPLETED" size="sm" />}
          />
          <AssetCard
            asset={ASSETS[2]}
            variant="default"
            aspect="1:1"
            badges={<StatusBadge domain="render" status="IN_PROGRESS" size="sm" />}
          />
        </div>
      </div>

      {/* Grid 9:16 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {ASSETS.slice(3, 12).map((a) => (
          <AssetCard
            key={a.id}
            asset={a}
            variant="default"
            aspect="9:16"
            onPlay={() => {}}
            badges={
              a.mimeType?.startsWith("video/") ? (
                <StatusBadge domain="render" status={["COMPLETED", "IN_PROGRESS", "QUEUED"][Math.floor(Math.random() * 3)]} size="sm" />
              ) : undefined
            }
            actions={<ButtonIcon icon={MoreHorizontal} label="Plus" variant="ghost" size="sm" />}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Vibe 4 : Empty hero signature ─────────────────────────────────────────

function EmptyHeroSignature() {
  return (
    <div
      className="relative rounded-3xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #fff5ed 0%, #fdf2f4 50%, #eff6fb 100%)",
      }}
    >
      {/* Décor blob signature */}
      <div
        className="absolute top-12 right-24 h-56 w-56 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, #f59e6b 0%, transparent 70%)" }}
        aria-hidden
      />
      <div
        className="absolute bottom-12 left-24 h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, #c97185 0%, transparent 70%)" }}
        aria-hidden
      />

      <div className="relative">
        <EmptyHero
          padding="xl"
          icon={Sparkles}
          title="Tout est à jour"
          description="Aucune action en attente. Profite du calme — ou démarre une nouvelle production."
          cta={<Button icon={Plus}>Nouveau slot</Button>}
          secondaryActions={
            <Button variant="ghost" icon={Calendar}>Voir le calendrier</Button>
          }
        />
      </div>
    </div>
  );
}
