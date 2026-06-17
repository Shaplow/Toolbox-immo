"use client";

/**
 * Phase 5 · Audit cohérence — outil de debug visuel.
 *
 * Aligne tous les composants côte à côte par catégorie pour repérer les
 * incohérences à l'œil : heights, focus rings, ring inset, shadows,
 * backdrop blur, gradient blanc, sizes, states.
 *
 * Pas une vitrine produit — un check interne. Les fixes identifiés ici
 * partent dans des commits "polish(ui): align X".
 */

import { useState } from "react";
import {
  Check,
  Eye,
  Plus,
  Search as SearchIcon,
  Settings,
  Bookmark,
  Filter,
  Heart,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Slider } from "@/components/ui/Slider";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Tabs } from "@/components/ui/Tabs";
import { Chip } from "@/components/ui/Chip";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Avatar } from "@/components/ui/Avatar";
import { Progress } from "@/components/ui/Progress";

// ─── Helpers ────────────────────────────────────────────────────────────────

function AuditSection({ id, title, eyebrow, hint, children }: { id: string; title: string; eyebrow: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground">{eyebrow}</p>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <p className="text-[12px] text-muted-foreground leading-relaxed max-w-2xl">{hint}</p>}
      </header>
      <div className="bg-card border border-border rounded-xl p-5 ">
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-6 py-2.5 border-b border-white/30 last:border-b-0">
      <div className="space-y-0.5">
        <p className="text-[11px] font-semibold text-foreground">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Note({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "warning" }) {
  return (
    <div
      className={[
        "mt-3 px-3 py-2 rounded-lg text-[11px] leading-relaxed",
        kind === "warning"
          ? "bg-warning-50/55 text-warning-700 "
          : "bg-info-50/55 text-info-700 ",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [v, setV] = useState("");
  const [v2, setV2] = useState("");
  const [v3, setV3] = useState("opt1");
  const [sw, setSw] = useState(true);
  const [chk, setChk] = useState(false);
  const [sl, setSl] = useState(40);
  const [tab, setTab] = useState("a");
  const [date, setDate] = useState("2026-06-15");
  const [time, setTime] = useState("18:00");
  const [num, setNum] = useState(16);
  const [filter, setFilter] = useState<string | null>("all");
  const [combo, setCombo] = useState("");

  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground">
          Phase 5 · Lot 1 · Audit cohérence
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Tout côte à côte — check visuel
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Aligne les composants par catégorie pour repérer les incohérences
          à l&apos;œil. Heights, focus rings, ring inset, shadows, backdrop
          blur, gradient blanc, états. Les fixes identifiés deviennent des
          commits <code className="text-[12px] font-mono">polish(ui): align X</code>.
        </p>
      </header>

      {/* ━━━ HEIGHTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="heights"
        eyebrow="Sizes"
        title="Heights — alignement vertical des composants"
        hint="Tous mis côte à côte sur une baseline. Devrait être uniforme : Button md / Input / Select / Combobox / Switch (track) = 32px (h-8). DatePicker / TimePicker exception 48px (h-12)."
      >
        <Row label="h-7 (sm)" hint="Compact toolbars">
          <Button size="sm">Button</Button>
          <ButtonIcon icon={Plus} label="Add" size="sm" />
          <Switch size="sm" checked={sw} onChange={setSw} />
        </Row>
        <Row label="h-8 (md, default)" hint="Forms et CTA standard">
          <Button size="md">Button</Button>
          <ButtonIcon icon={Plus} label="Add" size="md" />
          <div className="w-44"><Input value={v} onChange={setV} placeholder="Input" /></div>
          <div className="w-44">
            <Select value={v3} onChange={setV3} options={[
              { value: "opt1", label: "Option 1" },
              { value: "opt2", label: "Option 2" },
            ]} />
          </div>
          <div className="w-44">
            <Combobox value={combo} onChange={setCombo} placeholder="Combobox" options={[
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ]} />
          </div>
          <NumberStepper value={num} onChange={setNum} unit="px" />
        </Row>
        <Row label="h-9 (lg)" hint="CTA standout">
          <Button size="lg">Button</Button>
        </Row>
        <Row label="h-12 (xl)" hint="Tickets calendrier (exception)">
          <DatePicker value={date} onChange={setDate} />
          <TimePicker value={time} onChange={setTime} />
        </Row>
        <Note kind="info">
          <strong>Check</strong> : tous les h-8 sur une même baseline visuellement ? Si Button et Combobox sont décalés d&apos;1-2 px ça se voit ici.
        </Note>
      </AuditSection>

      {/* ━━━ FOCUS RINGS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="focus"
        eyebrow="States"
        title="Focus rings — Tab dans chaque composant"
        hint="Tab à travers cette section pour voir tous les focus visibles. Cible : focus-ring mono dark partout sauf inputs glass tinted sky → halo sky-200 0.4α 3px."
      >
        <Row label="Mono dark" hint="focus-ring utility">
          <Button>Button mono</Button>
          <ButtonIcon icon={Plus} label="ButtonIcon" />
          <div className="w-44"><Input value={v} onChange={setV} placeholder="Input default" /></div>
          <div className="w-44"><Select value={v3} onChange={setV3} options={[{value:"opt1",label:"Opt 1"}]} /></div>
        </Row>
        <Row label="Sky halo" hint="Input/Textarea/Select/Combobox/DatePicker (glass tinté sky)">
          <div className="w-44"><Input value={v2} onChange={setV2} placeholder="Tab here" /></div>
          <div className="w-44">
            <Combobox value={combo} onChange={setCombo} placeholder="Tab here" options={[
              { value: "a", label: "A" },
            ]} />
          </div>
          <DatePicker value={date} onChange={setDate} />
          <TimePicker value={time} onChange={setTime} />
        </Row>
        <Row label="Danger halo" hint="État error">
          <div className="w-44"><Input value="invalid@" onChange={() => {}} error="Email invalide" /></div>
          <Button variant="danger">Danger</Button>
        </Row>
        <Note kind="warning">
          <strong>À surveiller</strong> : si les inputs default (mono) ont un halo gray sombre alors que les inputs glass (sky) ont un halo sky-200, est-ce cohérent ?
          → Tous les inputs sont en variant default sky-tinted depuis le polish fields. Donc tous devraient avoir le halo sky.
          Vérifie qu&apos;il n&apos;y a plus d&apos;Input/Select avec focus mono.
        </Note>
      </AuditSection>

      {/* ━━━ RING INSET LADDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="ring-inset"
        eyebrow="Visuel"
        title="Ring inset edge — niveaux d&apos;opacité"
        hint="Le ring inset (signature glass : inset 0 0 0 1px rgba(15,23,42,X)) est utilisé à plusieurs niveaux. Si X varie sans règle, ça donne du noise. Cible : 0.06 fond / 0.08 default / 0.10-0.14 hover / 0.16+ focus."
      >
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[0.04, 0.06, 0.08, 0.10, 0.14, 0.18, 0.22, 0.28].map((alpha) => (
            <div
              key={alpha}
              className="h-16 rounded-lg bg-gradient-to-b from-white to-white/85"
              style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,1), inset 0 0 0 1px rgba(15,23,42,${alpha}), 0 1px 3px rgba(15,23,42,0.04)` }}
            >
              <div className="h-full flex items-center justify-center text-[11px] font-mono text-foreground">
                {alpha}
              </div>
            </div>
          ))}
        </div>
        <Note kind="info">
          <strong>Convention proposée</strong> : 0.06 (subtle interne) · 0.08 (default surface) · 0.10 (Card solid border) · 0.14 (hover) · 0.16 (default field) · 0.22 (hover field) · 0.28 (focus field).
        </Note>
      </AuditSection>

      {/* ━━━ SHADOWS GLASS LADDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="shadows"
        eyebrow="Visuel"
        title="Shadows verrerie — sm / md / lg / popover"
        hint="4 niveaux d&apos;élévation glass définis dans globals.css. Sur fond pastel pour voir la matière."
      >
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 rounded-xl"
          style={{ background: "linear-gradient(135deg, #ffe6d0 0%, #f7dde2 50%, #d4e8f3 100%)" }}
        >
          {[
            { name: "shadow-glass-sm", value: "var(--shadow-glass-sm)" },
            { name: "shadow-glass-md", value: "var(--shadow-glass-md)" },
            { name: "shadow-glass-lg", value: "var(--shadow-glass-lg)" },
            { name: "shadow-glass-popover", value: "var(--shadow-glass-popover)" },
          ].map((s) => (
            <div
              key={s.name}
              className="h-24 rounded-xl bg-card border border-border flex items-end p-3"
              style={{ boxShadow: s.value }}
            >
              <code className="text-[10px] font-mono text-foreground">{s.name}</code>
            </div>
          ))}
        </div>
      </AuditSection>

      {/* ━━━ BACKDROP BLUR LADDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="blur"
        eyebrow="Visuel"
        title="Backdrop blur — niveaux utilisés"
        hint="Plusieurs valeurs traînent (6/8/10/12/16/18/20/24). Cible : 6-8 atomes compacts (Kbd/Badge/Avatar), 10-12 fields, 16-20 cards/popovers, 24 modals."
      >
        <div
          className="grid grid-cols-2 lg:grid-cols-7 gap-3 p-6 rounded-xl"
          style={{ background: "linear-gradient(135deg, #ffe6d0 0%, #f7dde2 50%, #d4e8f3 100%)" }}
        >
          {[6, 8, 10, 12, 16, 18, 20, 24].map((px) => (
            <div
              key={px}
              className="h-24 rounded-xl bg-white/40 flex items-end p-3 "
              style={{ backdropFilter: `blur(${px}px) saturate(150%)` }}
            >
              <code className="text-[10px] font-mono text-foreground">{px}px</code>
            </div>
          ))}
        </div>
      </AuditSection>

      {/* ━━━ STATES MATRIX ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="states"
        eyebrow="States"
        title="States matrix — default / hover / disabled / loading / error"
        hint="Tous les composants interactifs avec leurs states. Hover : passe la souris dessus."
      >
        <Row label="Button" hint="Tous les variants × états">
          <Button>Default</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="secondary" disabled>2nd disabled</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="ghost" disabled>Ghost disabled</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="glass">Glass</Button>
          <Button variant="softPrimary">Soft</Button>
        </Row>
        <Row label="Input">
          <div className="w-44"><Input value="default" onChange={() => {}} /></div>
          <div className="w-44"><Input value="" onChange={() => {}} placeholder="placeholder" /></div>
          <div className="w-44"><Input value="error" onChange={() => {}} error="msg" /></div>
          <div className="w-44"><Input value="disabled" onChange={() => {}} disabled /></div>
        </Row>
        <Row label="Switch">
          <Switch checked={true} onChange={() => {}} label="On" />
          <Switch checked={false} onChange={() => {}} label="Off" />
          <Switch checked={true} onChange={() => {}} disabled label="Disabled on" />
          <Switch checked={true} onChange={() => {}} accent="sage" label="Sage on" />
        </Row>
        <Row label="Slider">
          <div className="w-48"><Slider value={sl} onChange={setSl} min={0} max={100} /></div>
          <div className="w-48"><Slider value={sl} onChange={setSl} min={0} max={100} disabled /></div>
        </Row>
        <Row label="Checkbox">
          <Checkbox checked={false} onChange={setChk} label="Unchecked" />
          <Checkbox checked={true} onChange={setChk} label="Checked" />
          <Checkbox checked="indeterminate" onChange={setChk} label="Indeterminate" />
          <Checkbox checked={true} onChange={setChk} disabled label="Disabled" />
        </Row>
      </AuditSection>

      {/* ━━━ INTERACTIVE COMBO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="combo"
        eyebrow="Combinaisons"
        title="Combinaisons en contexte"
        hint="Voir si les composants vivent ensemble harmonieusement quand combinés."
      >
        <Row label="Form ligne">
          <div className="flex flex-wrap items-end gap-2 w-full">
            <div className="w-44"><Input value={v} onChange={setV} placeholder="Nom" icon={SearchIcon} /></div>
            <div className="w-36">
              <Select value={v3} onChange={setV3} options={[
                { value: "opt1", label: "Type A" },
                { value: "opt2", label: "Type B" },
              ]} />
            </div>
            <NumberStepper value={num} onChange={setNum} unit="px" />
            <Switch checked={sw} onChange={setSw} label="Activé" />
            <Button>Sauvegarder</Button>
          </div>
        </Row>
        <Row label="Tabs + content">
          <div className="w-full max-w-md space-y-3">
            <Tabs
              items={[
                { id: "a", label: "Aperçu", icon: Eye },
                { id: "b", label: "Modifs", icon: Settings },
                { id: "c", label: "Activité" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="px-3 py-2 rounded-md bg-card border border-border  text-[12px] text-foreground">
              Contenu tab {tab}
            </div>
          </div>
        </Row>
        <Row label="Chips filtres + counter">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip variant="default" selected={filter === "all"} onClick={() => setFilter("all")}>Tous</Chip>
            <Chip variant="sage" selected={filter === "ok"} onClick={() => setFilter("ok")}>Validés</Chip>
            <Chip variant="sky" selected={filter === "scheduled"} onClick={() => setFilter("scheduled")}>Programmés</Chip>
            <Chip variant="rose" selected={filter === "blocked"} onClick={() => setFilter("blocked")}>Bloqués</Chip>
            <Badge>14</Badge>
            <ButtonIcon icon={Filter} label="Filtres avancés" variant="ghost" size="sm" />
          </div>
        </Row>
        <Row label="Card avec actions">
          <div className="w-full max-w-md p-4 rounded-xl bg-gradient-to-b from-white to-white/85 ">
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div className="flex items-center gap-2">
                <Avatar name="Alice Dubois" size="sm" />
                <div>
                  <p className="text-[13px] font-semibold text-foreground leading-tight">Alice Dubois</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Monteuse · @studio-paris</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="sage" dot>Active</Badge>
                <ButtonIcon icon={Bookmark} label="Favori" variant="ghost" size="sm" />
              </div>
            </div>
            <Progress value={73} accent="sky" showValue />
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-1.5">
                <Chip variant="peach" size="sm">3 en cours</Chip>
                <Chip variant="default" size="sm">12 cette semaine</Chip>
              </div>
              <div className="flex items-center gap-0.5">
                <ButtonIcon icon={Heart} label="Like" variant="ghost" size="sm" />
                <ButtonIcon icon={Trash2} label="Supprimer" variant="danger" size="sm" />
              </div>
            </div>
          </div>
        </Row>
      </AuditSection>

      {/* ━━━ BADGES / CHIPS LADDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="badges-chips"
        eyebrow="Tokens"
        title="Badges & Chips — tous les variants"
        hint="Comparaison directe pour valider que le palette Coastal Studio est lisible et cohérente."
      >
        <Row label="Badge sémantique">
          <Badge>Default</Badge>
          <Badge variant="success" icon={Check}>Publié</Badge>
          <Badge variant="danger">Refusé</Badge>
          <Badge variant="info">Programmé</Badge>
        </Row>
        <Row label="Badge Coastal">
          <Badge variant="peach" dot>Peach</Badge>
          <Badge variant="sage" dot>Sage</Badge>
          <Badge variant="sky" dot>Sky</Badge>
          <Badge variant="rose" dot>Rose</Badge>
        </Row>
        <Row label="Chip default">
          <Chip>Default</Chip>
          <Chip variant="peach">Peach</Chip>
          <Chip variant="sage">Sage</Chip>
          <Chip variant="sky">Sky</Chip>
          <Chip variant="rose">Rose</Chip>
        </Row>
        <Row label="Chip selected">
          <Chip selected onClick={() => {}}>Default</Chip>
          <Chip variant="peach" selected onClick={() => {}}>Peach</Chip>
          <Chip variant="sage" selected onClick={() => {}}>Sage</Chip>
          <Chip variant="sky" selected onClick={() => {}}>Sky</Chip>
          <Chip variant="rose" selected onClick={() => {}}>Rose</Chip>
        </Row>
        <Note kind="info">
          Comparer Chip default unselected vs selected, voir si le contraste est suffisant pour comprendre l&apos;état actif. Idem badge default vs Chip default (les deux gray-100 mais avec différents shadows).
        </Note>
      </AuditSection>

      {/* ━━━ AVATARS LADDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <AuditSection
        id="avatars"
        eyebrow="Tokens"
        title="Avatars — sizes + status + ring"
      >
        <Row label="Sizes">
          <Avatar name="Mathis Barbet" size="xs" />
          <Avatar name="Mathis Barbet" size="sm" />
          <Avatar name="Mathis Barbet" size="md" />
          <Avatar name="Mathis Barbet" size="lg" />
          <Avatar name="Mathis Barbet" size="xl" />
        </Row>
        <Row label="Status">
          <Avatar name="Alice" status="online" />
          <Avatar name="Bob" status="away" />
          <Avatar name="Camille" status="offline" />
          <Avatar name="Diane" />
        </Row>
        <Row label="Ring">
          <Avatar name="Sarah" ring />
          <Avatar name="Sarah" ring size="lg" />
        </Row>
      </AuditSection>

      {/* ━━━ Conclusion ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <div className="surface-glass-soft rounded-xl p-5 mt-12">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground mb-2">
          Comment utiliser cette page
        </p>
        <ol className="space-y-1.5 text-[13px] text-foreground leading-relaxed list-decimal pl-5">
          <li>Scroll dans chaque section. Note les incohérences à l&apos;œil (alignement, ring inset, focus, hover, shadow).</li>
          <li>Tab à travers les composants pour voir les focus rings tous d&apos;affilée.</li>
          <li>Liste les fixes nécessaires dans le chat.</li>
          <li>Je patche en commits ciblés <code className="text-[12px] font-mono">polish(ui): align X</code>.</li>
        </ol>
      </div>
    </div>
  );
}
