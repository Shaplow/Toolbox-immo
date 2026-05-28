/**
 * Showcase des primitives du design system (Phase 1).
 *
 * Sert de référence visuelle pour les variants, sizes et états de chaque
 * primitive. Sert aussi de test de régression : si une primitive change,
 * on doit voir l'impact ici immédiatement.
 *
 * Chaque section : <SectionHeading /> + grille des variants en colonnes,
 * sizes en lignes. États (loading, disabled, with icon) en sous-grille.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { ArrowRight, Plus, Send, Trash2 } from "lucide-react";

export default function PrimitivesPage() {
  const [text, setText] = useState("Lola Caupert");
  const [longText, setLongText] = useState("Un appartement plein de charme, vue dégagée sur le parc.");
  const [errored, setErrored] = useState("");
  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Primitives</h1>
        <p className="max-w-prose text-sm text-gray-500">
          Composants atomiques alignés sur les tokens. Variants, sizes et
          états visibles côte à côte pour validation et test de régression.
        </p>
      </header>

      {/* ── Button ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Button"
          subtitle="5 variants (primary mono · brand orange · secondary · ghost · danger) × 3 sizes (sm · md · lg)."
        />

        {/* Grille variants × sizes */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="grid grid-cols-[80px_repeat(5,minmax(0,1fr))] items-center gap-3 text-xs">
            <span className="text-[10px] uppercase tracking-widest text-gray-400">Size</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">primary</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">brand</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">secondary</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">ghost</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400">danger</span>

            {(["sm", "md", "lg"] as const).map((size) => (
              <SizeRow key={size} size={size} />
            ))}
          </div>
        </div>

        {/* États */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">Avec icône</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={Plus}>Nouveau</Button>
              <Button variant="brand" icon={Send}>Envoyer</Button>
              <Button variant="secondary" icon={ArrowRight}>Continuer</Button>
              <Button variant="danger" icon={Trash2} size="sm">Supprimer</Button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">Loading · disabled</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button loading>Sauvegarder</Button>
              <Button variant="brand" loading>Envoi…</Button>
              <Button variant="secondary" disabled>Disabled</Button>
              <Button variant="ghost" disabled>Disabled ghost</Button>
            </div>
          </div>
        </div>

        {/* Hero CTA — démonstration du brand glow */}
        <div className="rounded-xl border border-gray-200 bg-[var(--gradient-hero)] p-10 text-center space-y-4">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">Combo hero</p>
          <p className="font-serif italic text-3xl text-gray-950">Prêt à publier ?</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="brand" size="lg" icon={Send}>Démarrer</Button>
            <Button variant="ghost" size="lg" icon={ArrowRight}>En savoir plus</Button>
          </div>
        </div>
      </section>

      {/* ── Input / Textarea / FormField ──────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading
          title="Input · Textarea · FormField"
          subtitle="Champs contrôlés (value/onChange string). FormField wrap avec label + required + help + error."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* États Input */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">Input</p>
            <FormField label="Nom du compte" required help="Le handle Instagram sans @.">
              <Input value={text} onChange={setText} placeholder="lola_caupert" />
            </FormField>
            <FormField
              label="Email"
              error="Format d'email invalide."
            >
              <Input value={errored} onChange={setErrored} placeholder="contact@studio.fr" />
            </FormField>
            <FormField label="ID compte (lecture seule)">
              <Input value="acc_8f3z2x9p" onChange={() => {}} disabled />
            </FormField>
          </div>

          {/* États Textarea */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">Textarea</p>
            <FormField
              label="Légende Instagram"
              help="Cmd/Ctrl + Entrée pour valider."
            >
              <Textarea
                value={longText}
                onChange={setLongText}
                rows={4}
                placeholder="Écris la légende ici…"
              />
            </FormField>
            <FormField label="Notes monteur (désactivé)">
              <Textarea
                value="Pas d'accès à ce champ."
                onChange={() => {}}
                disabled
                rows={2}
              />
            </FormField>
          </div>
        </div>
      </section>

      <p className="border-t border-gray-200 pt-6 text-[11px] text-gray-400">
        Cette page grossira au fil de la Phase 1. Chaque nouvelle primitive
        ajoute une section ici avant d&apos;être propagée dans l&apos;app.
      </p>
    </div>
  );
}

function SizeRow({ size }: { size: "sm" | "md" | "lg" }) {
  return (
    <>
      <code className="text-[11px] font-mono text-gray-400">{size}</code>
      <Button size={size}>Button</Button>
      <Button variant="brand" size={size}>Button</Button>
      <Button variant="secondary" size={size}>Button</Button>
      <Button variant="ghost" size={size}>Button</Button>
      <Button variant="danger" size={size}>Button</Button>
    </>
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
