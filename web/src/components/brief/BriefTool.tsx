"use client";

/**
 * BriefTool — génération d'un brief de montage destiné au monteur.
 *
 * Outil standalone : la sortie est copiée par l'admin, elle n'est écrite sur aucune
 * publication. Trois sources de transcription possibles (collage, fichier,
 * transcription existante) et deux formats de sortie.
 *
 * Le format n'est pas cosmétique : un brief part parfois dans Notion (où le
 * Markdown est rendu) et parfois dans WhatsApp ou un mail (où il s'afficherait en
 * clair). Le toggle pilote donc les consignes envoyées au modèle, pas seulement
 * l'affichage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  ClipboardList,
  Copy,
  Check,
  FileText,
  Loader2,
  Upload,
  Wand2,
  History,
  ChevronDown,
  Mic,
  Type,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import {
  extractTranscriptText,
  TRANSCRIPT_FILE_ACCEPT,
} from "@/lib/transcription/parseTranscriptFile";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BriefPromptRow = {
  id: string;
  name: string;
  prompt: string;
  recipeKind: string;
};

export type BriefJobRow = {
  id: string;
  status: string;
  model: string;
  inputFilename: string | null;
  result: string | null;
  errorMsg: string | null;
  createdAt: string;
  prompt: { name: string } | null;
};

type SourceTab = "paste" | "file" | "transcription";
type OutputFormat = "markdown" | "plain";
type Model = "claude" | "gpt";

type TranscriptionOption = {
  id: string;
  inputFilename: string | null;
  createdAt: string;
  duration: number | null;
};

const MAX_EXTRA_INFO_CHARS = 2_000;

const SOURCE_TABS: { key: SourceTab; label: string; icon: typeof Type }[] = [
  { key: "paste", label: "Coller un texte", icon: Type },
  { key: "file", label: "Fichier SRT / JSON", icon: Upload },
  { key: "transcription", label: "Transcription existante", icon: Mic },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function BriefTool({
  initialPrompts,
  initialJobs,
  aiConfig,
}: {
  initialPrompts: BriefPromptRow[];
  initialJobs: BriefJobRow[];
  aiConfig: { hasClaude: boolean; hasGPT: boolean };
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceTab, setSourceTab] = useState<SourceTab>("paste");
  const [transcriptText, setTranscriptText] = useState("");
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);

  const [transcriptions, setTranscriptions] = useState<TranscriptionOption[]>([]);
  const [loadingTranscriptions, setLoadingTranscriptions] = useState(false);

  const [promptId, setPromptId] = useState<string | null>(initialPrompts[0]?.id ?? null);
  const [extraInfo, setExtraInfo] = useState("");
  const [format, setFormat] = useState<OutputFormat>("markdown");
  const [model, setModel] = useState<Model>(aiConfig.hasClaude ? "claude" : "gpt");

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);
  const [jobs, setJobs] = useState<BriefJobRow[]>(initialJobs);
  const [historyOpen, setHistoryOpen] = useState(false);

  const canGenerate =
    !!promptId && transcriptText.trim().length > 0 && !generating &&
    (aiConfig.hasClaude || aiConfig.hasGPT);

  const selectedPrompt = useMemo(
    () => initialPrompts.find((p) => p.id === promptId) ?? null,
    [initialPrompts, promptId],
  );

  // ── Sources ────────────────────────────────────────────────────────────────

  const loadTranscriptions = useCallback(async () => {
    setLoadingTranscriptions(true);
    try {
      const res = await fetch("/api/transcription", { cache: "no-store" });
      const payload = (await res.json()) as { jobs?: (TranscriptionOption & { status: string })[] };
      setTranscriptions((payload.jobs ?? []).filter((j) => j.status === "COMPLETED"));
    } catch {
      toast.error("Impossible de charger les transcriptions.");
    } finally {
      setLoadingTranscriptions(false);
    }
  }, []);

  useEffect(() => {
    if (sourceTab === "transcription" && transcriptions.length === 0) {
      void loadTranscriptions();
    }
  }, [sourceTab, transcriptions.length, loadTranscriptions]);

  function resetSource() {
    setTranscriptText("");
    setSourceLabel(null);
    setTranscriptionId(null);
  }

  async function handleFile(file: File) {
    const raw = await file.text();
    const extracted = extractTranscriptText(file.name, raw);
    if (extracted === null) {
      toast.error("Formats acceptés : .srt ou .json");
      return;
    }
    if (!extracted.trim()) {
      toast.error("Aucun texte lisible dans ce fichier.");
      return;
    }
    setTranscriptText(extracted);
    setSourceLabel(file.name);
    setTranscriptionId(null);
  }

  async function handlePickTranscription(option: TranscriptionOption) {
    try {
      const res = await fetch(`/api/transcription/${option.id}/download?format=srt`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const raw = await res.text();
      const extracted = extractTranscriptText("x.srt", raw) ?? "";
      if (!extracted.trim()) {
        toast.error("Cette transcription ne contient pas de texte.");
        return;
      }
      setTranscriptText(extracted);
      setSourceLabel(option.inputFilename ?? "Transcription");
      // On envoie aussi l'id : le serveur retrace ainsi le job source dans
      // l'historique, même si le texte est déjà résolu côté client.
      setTranscriptionId(option.id);
    } catch {
      toast.error("Impossible de récupérer cette transcription.");
    }
  }

  // ── Génération ─────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (!promptId) return;
    setGenerating(true);
    setResult("");
    try {
      const res = await fetch("/api/brief/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId,
          transcriptText,
          transcriptionId: transcriptionId ?? undefined,
          extraInfo: extraInfo.trim() || undefined,
          model,
          format,
          inputFilename: sourceLabel ?? undefined,
        }),
      });
      const payload = (await res.json()) as { result?: string; error?: string };
      if (!res.ok || !payload.result) {
        throw new Error(payload.error ?? `Erreur ${res.status}`);
      }
      setResult(payload.result);
      toast.success("Brief généré.");

      // Rafraîchit l'historique — filtré sur kind=brief côté serveur.
      const jobsRes = await fetch("/api/description/jobs?kind=brief", { cache: "no-store" });
      if (jobsRes.ok) setJobs((await jobsRes.json()) as BriefJobRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Génération échouée.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(text: string) {
    // Toujours le texte brut du modèle, jamais le HTML rendu par la preview :
    // sinon un collage dans WhatsApp ou un mail récupérerait du markup.
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copié.");
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Copie impossible.");
    }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────

  if (initialPrompts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardList}
          title="Aucun prompt de brief"
          description="Créez d'abord un prompt de type « Brief monteur » dans Configuration → Prompts IA, puis revenez ici."
          cta={{
            label: "Gérer les prompts",
            onClick: () => window.location.assign("/admin/prompts"),
          }}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Source de la transcription ── */}
      <Card>
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 border-b border-border pb-2">
            {SOURCE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = sourceTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setSourceTab(tab.key);
                    resetSource();
                  }}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {sourceTab === "paste" && (
            <FormField label="Transcription">
              <Textarea
                value={transcriptText}
                onChange={(value) => {
                  setTranscriptText(value);
                  setSourceLabel(null);
                  setTranscriptionId(null);
                }}
                rows={8}
                placeholder="Collez ici le texte de la transcription des rushs…"
              />
            </FormField>
          )}

          {sourceTab === "file" && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border py-8 transition-colors hover:border-primary hover:bg-muted"
              >
                <Upload size={20} className="text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground">
                  Choisir un fichier
                </span>
                <span className="text-xs text-muted-foreground">SRT ou JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={TRANSCRIPT_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {sourceTab === "transcription" && (
            <div className="space-y-1.5">
              {loadingTranscriptions ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Chargement des transcriptions…
                </div>
              ) : transcriptions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aucune transcription terminée.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {transcriptions.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void handlePickTranscription(t)}
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors",
                        transcriptionId === t.id
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-muted",
                      ].join(" ")}
                    >
                      <span className="truncate text-foreground">
                        {t.inputFilename ?? "Sans nom"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtDate(t.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {transcriptText.trim().length > 0 && (
            <p className="text-xs text-muted-foreground">
              {sourceLabel ? `${sourceLabel} — ` : ""}
              {transcriptText.length.toLocaleString("fr-FR")} caractères prêts.
            </p>
          )}
        </div>
      </Card>

      {/* ── Prompt ── */}
      <Card>
        <div className="space-y-2">
          <FormField label="Prompt de brief">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {initialPrompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPromptId(p.id)}
                  className={[
                    "rounded-md border px-2.5 py-2 text-left transition-colors",
                    promptId === p.id
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="block text-[13px] font-medium text-foreground">{p.name}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                    {p.prompt}
                  </span>
                </button>
              ))}
            </div>
          </FormField>
          {selectedPrompt?.recipeKind === "two_pass_reformulate" && (
            <p className="text-xs text-muted-foreground">
              Ce prompt fait deux appels au modèle (résumé puis rédaction) — comptez un peu plus de temps.
            </p>
          )}
        </div>
      </Card>

      {/* ── Infos complémentaires + réglages ── */}
      <Card>
        <div className="space-y-3">
          <FormField
            label="Informations complémentaires"
            help={`Contexte que la transcription ne porte pas : deadline, format attendu, consignes de rythme… (${extraInfo.length} / ${MAX_EXTRA_INFO_CHARS})`}
          >
            <Textarea
              value={extraInfo}
              onChange={(value) => setExtraInfo(value.slice(0, MAX_EXTRA_INFO_CHARS))}
              rows={3}
              placeholder="Ex : format 9:16, 45 s max, garder les plans drone du début, livrer vendredi."
            />
          </FormField>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-4">
              <FormField label="Format de sortie">
                <div className="flex gap-1">
                  {(
                    [
                      { key: "markdown" as const, label: "Markdown" },
                      { key: "plain" as const, label: "Texte brut" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setFormat(opt.key)}
                      className={[
                        "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        format === opt.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Modèle">
                <div className="flex gap-1">
                  {(
                    [
                      { key: "claude" as const, label: "Claude", enabled: aiConfig.hasClaude },
                      { key: "gpt" as const, label: "ChatGPT", enabled: aiConfig.hasGPT },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!opt.enabled}
                      title={opt.enabled ? undefined : "Clé d'API non configurée sur ce serveur"}
                      onClick={() => setModel(opt.key)}
                      className={[
                        "rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                        model === opt.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                        !opt.enabled ? "cursor-not-allowed opacity-40" : "",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>

            <Button onClick={() => void handleGenerate()} disabled={!canGenerate}>
              {generating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Génération…
                </>
              ) : (
                <>
                  <Wand2 size={14} />
                  Générer le brief
                </>
              )}
            </Button>
          </div>

          {!aiConfig.hasClaude && !aiConfig.hasGPT && (
            <p className="text-xs text-danger-600">
              Aucune clé d&apos;API IA configurée sur ce serveur — la génération est indisponible.
            </p>
          )}
        </div>
      </Card>

      {/* ── Résultat ── */}
      {result && (
        <Card>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Brief généré</h2>
              <Button variant="outline" size="sm" onClick={() => void handleCopy(result)}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copié" : "Copier"}
              </Button>
            </div>

            {/* Aperçu selon le format demandé. En texte brut, aucune
                interprétation : c'est exactement ce qui sera collé. */}
            {format === "markdown" ? (
              <div className="prose prose-sm max-w-none rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] text-foreground">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{result}</ReactMarkdown>
              </div>
            ) : (
              <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
                {result}
              </pre>
            )}

            <FormField label="Texte éditable" help="Vos retouches sont incluses dans la copie.">
              <Textarea value={result} onChange={setResult} rows={10} />
            </FormField>
          </div>
        </Card>
      )}

      {/* ── Historique ── */}
      <Card>
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History size={14} />
            Historique ({jobs.length})
          </span>
          <ChevronDown
            size={14}
            className={[
              "text-muted-foreground transition-transform",
              historyOpen ? "rotate-180" : "",
            ].join(" ")}
          />
        </button>

        {historyOpen && (
          <div className="mt-3 space-y-1.5">
            {jobs.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Aucun brief généré pour le moment.
              </p>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border px-2.5 py-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-[13px] text-foreground">
                      {job.prompt?.name ?? "Prompt supprimé"}
                      {job.inputFilename ? ` — ${job.inputFilename}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(job.createdAt)} · {job.model}
                      {job.status === "FAILED" ? " · échec" : ""}
                    </p>
                    {job.status === "FAILED" && job.errorMsg && (
                      <p className="text-xs text-danger-600">{job.errorMsg}</p>
                    )}
                  </div>
                  {job.result && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setResult(job.result!)}>
                        <FileText size={13} />
                        Reprendre
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleCopy(job.result!)}
                      >
                        <Copy size={13} />
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
