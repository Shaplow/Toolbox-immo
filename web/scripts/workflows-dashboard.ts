#!/usr/bin/env tsx
/**
 * Génère `.claude/workflows/index.html` : un dashboard statique qui liste
 * tous les workflows mappés via `/map-workflow`. Chaque card pointe vers
 * le fichier Markdown source.
 *
 * Exécution :
 *   cd web && npm run workflows:dashboard
 *
 * Lance la commande après chaque ajout / modification d'un fichier
 * `.claude/workflows/*.md`. La slash command `/map-workflow` l'invoque
 * automatiquement à la fin de sa procédure.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve, basename } from "path";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const webDir = resolve(scriptDir, "..");
const repoRoot = resolve(webDir, "..");
const workflowsDir = resolve(repoRoot, ".claude", "workflows");

interface WorkflowMeta {
  slug: string;
  name: string;
  generatedAt: string;
  pitch: string;
  file: string;
}

function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function extractPitch(md: string): string {
  const m = md.match(/##\s+Pitch\s*\n+([^\n#][^\n]*)/i);
  return m ? m[1].trim() : "";
}

function readWorkflows(): WorkflowMeta[] {
  let files: string[] = [];
  try {
    files = readdirSync(workflowsDir).filter(
      (f) => f.endsWith(".md") && !f.startsWith("."),
    );
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const full = resolve(workflowsDir, file);
      const md = readFileSync(full, "utf-8");
      const fm = parseFrontmatter(md);
      return {
        slug: fm.slug ?? basename(file, ".md"),
        name: fm.name ?? basename(file, ".md"),
        generatedAt: fm.generatedAt ?? "",
        pitch: extractPitch(md),
        file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(workflows: WorkflowMeta[]): string {
  const generatedAt = new Date().toISOString();
  const grid =
    workflows.length === 0
      ? `<div class="empty"><p>Aucun workflow mappé pour l'instant.</p><p>Lance <code>/map-workflow "publication captions auto"</code> pour créer le premier.</p></div>`
      : `<div class="grid">\n${workflows
          .map(
            (w) =>
              `      <div class="card"><a href="./${w.file}"><p class="card-title">${escapeHtml(w.name)}</p><p class="card-slug">${w.slug}</p><p class="card-pitch">${escapeHtml(w.pitch || "(pas de pitch fourni)")}</p><div class="card-meta"><code>${w.file}</code>${w.generatedAt ? `<span>généré le ${w.generatedAt.slice(0, 10)}</span>` : ""}</div></a></div>`,
          )
          .join("\n")}\n    </div>`;

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Toolbox Immo — Workflow maps</title>
  <style>
    :root {
      color-scheme: light;
      --bg-grad: linear-gradient(180deg, #fdf4ec 0%, #f3e8fd 50%, #e8f0fd 100%);
      --card-bg: rgba(255, 255, 255, 0.7);
      --card-border: rgba(15, 23, 42, 0.08);
      --text: #1f2937;
      --text-muted: #6b7280;
      --accent: #6366f1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg-grad);
      min-height: 100vh;
      padding: 2rem;
    }
    main { max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 .5rem; }
    .subtitle { color: var(--text-muted); margin: 0 0 2rem; font-size: 0.95rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(8px) saturate(150%);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.25rem;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 1), 0 2px 8px rgba(15, 23, 42, 0.05);
      transition: transform .1s ease, box-shadow .1s ease;
    }
    .card:hover { transform: translateY(-1px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 1), 0 4px 16px rgba(15, 23, 42, 0.08); }
    .card a { color: inherit; text-decoration: none; display: block; }
    .card-title { font-size: 1rem; font-weight: 600; margin: 0 0 .35rem; }
    .card-slug { font-family: ui-monospace, monospace; font-size: 0.7rem; color: var(--accent); margin-bottom: .65rem; }
    .card-pitch { color: var(--text-muted); font-size: 0.85rem; line-height: 1.4; margin: 0 0 .75rem; }
    .card-meta { font-size: 0.7rem; color: var(--text-muted); display: flex; gap: .75rem; align-items: center; }
    .card-meta code { background: rgba(15, 23, 42, 0.06); padding: .15rem .4rem; border-radius: .35rem; font-size: 0.65rem; }
    .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
    .empty code { background: rgba(15, 23, 42, 0.06); padding: .15rem .4rem; border-radius: .35rem; }
    footer { margin-top: 3rem; text-align: center; color: var(--text-muted); font-size: 0.75rem; }
  </style>
</head>
<body>
  <main>
    <h1>Workflow maps</h1>
    <p class="subtitle">${workflows.length} workflow${workflows.length > 1 ? "s" : ""} mappé${workflows.length > 1 ? "s" : ""} — clique sur une card pour ouvrir le Markdown détaillé.</p>
    ${grid}
    <footer>Généré le ${generatedAt.slice(0, 16)} · <code>npm run workflows:dashboard</code></footer>
  </main>
</body>
</html>
`;
}

function main() {
  const workflows = readWorkflows();
  const html = renderHtml(workflows);
  const outPath = resolve(workflowsDir, "index.html");
  writeFileSync(outPath, html, "utf-8");
  console.log(`✅ Dashboard généré : ${outPath}`);
  console.log(`   ${workflows.length} workflow${workflows.length > 1 ? "s" : ""} listé${workflows.length > 1 ? "s" : ""}`);
  if (workflows.length === 0) {
    console.log(`\n   Lance \`/map-workflow "<nom>"\` pour créer le premier.`);
  }
}

main();
