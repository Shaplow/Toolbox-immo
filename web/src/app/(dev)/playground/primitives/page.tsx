"use client";

/**
 * Showcase des primitives — doctrine SaaS d'équipe.
 * Mono · density Linear · icon-first.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
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
} from "lucide-react";

export default function PrimitivesPage() {
  const [handle, setHandle] = useState("lola_caupert");
  const [email, setEmail] = useState("contact@lacaupertstudio.fr");
  const [emailError, setEmailError] = useState("Format invalide.");
  const [search, setSearch] = useState("");
  const [caption, setCaption] = useState("Un appartement plein de charme, vue dégagée sur le parc.");

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Primitives</h1>
        <p className="max-w-prose text-sm text-gray-500">
          Mono dark + density Linear + icon-first. Le primary est{" "}
          <code className="font-mono">bg-gray-950</code> flat — pas de gradient,
          pas de couleur, pas de glow. La signature passe par la rigueur, pas
          par la déco.
        </p>
      </header>

      {/* ── Button ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Button"
          subtitle="4 variants (primary · secondary · ghost · danger) × 3 sizes (sm · md · lg). Focus mono dark."
        />

        {/* Grille variants × sizes */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="grid grid-cols-[60px_repeat(4,minmax(0,1fr))] items-center gap-2 text-xs">
            <span className="text-[10px] uppercase tracking-widest text-gray-400">Size</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">primary</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">secondary</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">ghost</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">danger</span>
            {(["sm", "md", "lg"] as const).map((size) => (
              <ButtonRow key={size} size={size} />
            ))}
          </div>
        </div>

        {/* Avec icon (recommandé pour actions significatives) */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <Eyebrow>Avec icône (recommandé)</Eyebrow>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={Plus}>Nouveau slot</Button>
            <Button variant="secondary" icon={Filter}>Filtrer</Button>
            <Button variant="secondary" icon={Download}>Exporter</Button>
            <Button variant="ghost" icon={RefreshCw}>Rafraîchir</Button>
            <Button variant="danger" icon={Trash2}>Supprimer</Button>
            <Button variant="ghost" icon={ArrowRight} iconRight>Continuer</Button>
          </div>
        </div>

        {/* ButtonIcon — pattern toolbar Linear/Raycast */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <Eyebrow>ButtonIcon · toolbar dense</Eyebrow>
          <div className="flex items-center gap-1">
            <ButtonIcon icon={Plus} label="Ajouter" />
            <ButtonIcon icon={Copy} label="Dupliquer" />
            <ButtonIcon icon={RefreshCw} label="Rafraîchir" />
            <span className="mx-1 h-4 w-px bg-gray-200" />
            <ButtonIcon icon={MoreHorizontal} label="Plus d'actions" />
            <ButtonIcon icon={Trash2} label="Supprimer" variant="danger" />
            <span className="ml-auto" />
            <ButtonIcon icon={X} label="Fermer" />
          </div>
        </div>

        {/* États */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
            <Eyebrow>Loading</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <Button loading>Sauvegarder</Button>
              <Button variant="secondary" loading icon={Send}>Envoi…</Button>
              <ButtonIcon icon={RefreshCw} label="Rafraîchir" loading />
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
            <Eyebrow>Disabled</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled>Sauvegarder</Button>
              <Button variant="secondary" disabled icon={Lock}>Verrouillé</Button>
              <Button variant="ghost" disabled>Disabled ghost</Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Input / Textarea / FormField ──────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Input · Textarea · FormField"
          subtitle="Icône leading systématique sur les inputs typés. Labels en eyebrow uppercase tiny. Focus mono dark."
        />

        {/* Inputs avec icône leading */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <Eyebrow>Inputs · icon-first</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        {/* Search + textarea */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
          <Eyebrow>Search · trailing badge</Eyebrow>
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
          <FormField
            label="Légende Instagram"
            help="Cmd/Ctrl + Entrée pour valider."
          >
            <Textarea
              value={caption}
              onChange={setCaption}
              rows={3}
              placeholder="Écris la légende ici…"
            />
          </FormField>
        </div>

        {/* Mockup liste dense Linear */}
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/40 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Eyebrow>Slots cette semaine</Eyebrow>
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
      </section>

      <p className="border-t border-gray-200 pt-6 text-[11px] text-gray-400">
        Cette page grossira au fil de la Phase 1. Chaque nouvelle primitive
        ajoute une section ici avant d&apos;être propagée dans l&apos;app.
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
      {children}
    </p>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-[12px] text-gray-500">{subtitle}</p>}
    </div>
  );
}
