"use client";

/**
 * « Remplir la semaine » — répartit les reels auto entre les comptes.
 *
 * Remplace le geste qui coûtait le plus de temps : créer les publications une
 * par une dans AddSlotModal en scrutant le calendrier entre chaque, pour ne pas
 * reposter la même recette trop vite sur des comptes qui partagent l'audience.
 *
 * Le calcul vit dans `lib/calendar/dispatch`, PUR et côté client : recalculer à
 * chaque case échangée ne coûte donc aucun aller-retour serveur. Le serveur ne
 * fournit que la matière (pool + historique) et écrit à la fin.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Alert } from "@/components/ui/Alert";
import { Chip } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import {
  cellKey,
  dispatchRecipes,
  minimumAchievableGap,
  rankCandidatesForCell,
  type DispatchCandidate,
  type DispatchCell,
  type RecipeHistory,
} from "@/lib/calendar/dispatch";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Lundi → vendredi : le défaut, et ce que montrent ses semaines. */
const DEFAULT_DAYS = [0, 1, 2, 3, 4];
const STORAGE_KEY = "calendar:week-fill:v1";

interface WeekFillContext {
  accounts: { id: string; name: string; handle: string }[];
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  pool: { patternTemplateId: string; label: string; accountCount: number }[];
  existingUse: Record<string, RecipeHistory>;
  occupiedByAccount: Record<string, string[]>;
}

interface WeekFillModalProps {
  /** Lundi de la semaine affichée. */
  weekStart: Date;
  accounts: { id: string; name: string; handle: string }[];
  /** Compte filtré sur le calendrier — pré-coché s'il y en a un. */
  filteredAccountId?: string;
  onCreated: () => void;
  onClose: () => void;
}

/** "YYYY-MM-DD" du n-ième jour de la semaine, en heure locale (= Paris ici). */
function dayKeyOf(weekStart: Date, offset: number): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface RememberedPrefs {
  poolTemplateIds?: string[];
  dayOffsets?: number[];
  perDay?: number;
}

function loadPrefs(): RememberedPrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as RememberedPrefs;
  } catch {
    // localStorage indisponible (navigation privée, stockage bloqué) : on
    // repart des défauts plutôt que de casser l'écran.
    return {};
  }
}

function savePrefs(prefs: RememberedPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* sans conséquence : la sélection repartira des défauts */
  }
}

export function WeekFillModal({
  weekStart,
  accounts,
  filteredAccountId,
  onCreated,
  onClose,
}: WeekFillModalProps) {
  const [context, setContext] = useState<WeekFillContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [accountIds, setAccountIds] = useState<string[]>(() =>
    filteredAccountId ? [filteredAccountId] : accounts.map((a) => a.id),
  );
  const [dayOffsets, setDayOffsets] = useState<number[]>(
    () => loadPrefs().dayOffsets ?? DEFAULT_DAYS,
  );
  const [perDay, setPerDay] = useState(() => loadPrefs().perDay ?? 1);
  const [poolIds, setPoolIds] = useState<string[] | null>(() => loadPrefs().poolTemplateIds ?? null);
  /** Choix manuels : `cellKey` → recette, ou `null` pour une case vidée. */
  const [pinned, setPinned] = useState<Record<string, string | null>>({});

  // ── Le contexte serveur ───────────────────────────────────────────────────
  const accountKey = accountIds.join(",");
  useEffect(() => {
    if (!accountKey) {
      setContext(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(
      `/api/calendar/week-fill?accountIds=${encodeURIComponent(accountKey)}&weekStart=${weekStart.toISOString()}`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error);
        return (await r.json()) as WeekFillContext;
      })
      .then((data) => {
        if (cancelled) return;
        setContext(data);
        // Les choix manuels portent sur un contexte donné : le changement de
        // périmètre les rendrait incohérents.
        setPinned({});
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message || "Chargement impossible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKey, weekStart]);

  // Pool effectif : la sélection mémorisée, restreinte à ce qui existe vraiment.
  const effectivePool = useMemo(() => {
    const available = context?.pool.map((p) => p.patternTemplateId) ?? [];
    if (!poolIds) return available;
    const kept = poolIds.filter((id) => available.includes(id));
    return kept.length > 0 ? kept : available;
  }, [context, poolIds]);

  const candidatesByAccount = useMemo(() => {
    const out: Record<string, DispatchCandidate[]> = {};
    for (const [accountId, list] of Object.entries(context?.candidatesByAccount ?? {})) {
      out[accountId] = list.filter((c) => effectivePool.includes(c.patternTemplateId));
    }
    return out;
  }, [context, effectivePool]);

  const selectedAccounts = useMemo(
    () => accounts.filter((a) => accountIds.includes(a.id)),
    [accounts, accountIds],
  );

  // ── Les cases, et la proposition ──────────────────────────────────────────
  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const [accountId, days] of Object.entries(context?.occupiedByAccount ?? {})) {
      for (const dayKey of days) set.add(`${accountId}|${dayKey}`);
    }
    return set;
  }, [context]);

  const cells = useMemo<DispatchCell[]>(() => {
    const out: DispatchCell[] = [];
    for (const offset of [...dayOffsets].sort((a, b) => a - b)) {
      const dayKey = dayKeyOf(weekStart, offset);
      for (const account of selectedAccounts) {
        // Une journée déjà occupée sur ce compte n'est jamais réécrite.
        if (occupied.has(`${account.id}|${dayKey}`)) continue;
        for (let rank = 0; rank < perDay; rank++) {
          out.push({ accountId: account.id, dayKey, rank });
        }
      }
    }
    return out;
  }, [dayOffsets, weekStart, selectedAccounts, perDay, occupied]);

  const proposal = useMemo(
    () =>
      dispatchRecipes({
        cells,
        candidatesByAccount,
        existingUse: context?.existingUse ?? {},
        pinned,
      }),
    [cells, candidatesByAccount, context, pinned],
  );

  const byCell = useMemo(
    () => new Map(proposal.assignments.map((a) => [cellKey(a.cell), a])),
    [proposal],
  );

  /**
   * La borne se calcule sur les CONTENUS distincts, pas sur les recettes : deux
   * recettes rendues depuis le même template builder ne comptent que pour une,
   * et annoncer 4 là où il n'y a que 3 contenus rendrait le chiffre faux —
   * c'est-à-dire inutile.
   */
  const distinctContents = useMemo(() => {
    const keys = new Set<string>();
    for (const list of Object.values(candidatesByAccount)) {
      for (const c of list) keys.add(c.contentKey);
    }
    return keys.size;
  }, [candidatesByAccount]);

  const minGap = minimumAchievableGap(distinctContents, selectedAccounts.length * perDay);

  // ── Création ──────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/calendar/week-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cells: proposal.assignments.map((a) => ({
            accountId: a.cell.accountId,
            patternBindingId: a.candidate.patternBindingId,
            dayKey: a.cell.dayKey,
            time: a.candidate.publishTime,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: unknown[];
        failed?: { label: string; dayKey: string; error: string }[];
      };
      if (!res.ok) {
        toast.error(data.error ?? "Création impossible.");
        return;
      }
      const created = data.ok?.length ?? 0;
      if (data.failed?.length) {
        toast.error(
          `${created} créée(s), ${data.failed.length} refusée(s) : ${data.failed
            .map((f) => `${f.label} le ${f.dayKey} (${f.error})`)
            .join(" · ")}`,
        );
      } else {
        toast.success(`${created} publication${created > 1 ? "s" : ""} créée${created > 1 ? "s" : ""}.`);
      }
      savePrefs({ poolTemplateIds: effectivePool, dayOffsets, perDay });
      onCreated();
      onClose();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setCreating(false);
    }
  }, [proposal, effectivePool, dayOffsets, perDay, onCreated, onClose]);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <Modal open onClose={onClose} size="full">
      <div className="flex flex-col max-h-[calc(100vh-2rem)]">
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <h2 className="text-[16px] font-semibold text-foreground">Remplir la semaine</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Chaque case reçoit la recette servie il y a le plus longtemps, tous comptes confondus.
            {minGap !== null && (
              <>
                {" "}
                <span className="text-foreground">
                  {distinctContents} contenu{distinctContents > 1 ? "s" : ""} distinct
                  {distinctContents > 1 ? "s" : ""} ·{" "}
                  {selectedAccounts.length * perDay} publication
                  {selectedAccounts.length * perDay > 1 ? "s" : ""}/jour → écart minimum
                  atteignable : {minGap} j
                </span>
              </>
            )}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── Périmètre ─────────────────────────────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-3">
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Comptes
              </h3>
              <div className="space-y-1">
                {accounts.map((a) => (
                  // `Checkbox.label` est sr-only : le texte visible se met à
                  // côté, comme partout ailleurs dans le repo.
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={accountIds.includes(a.id)}
                      onChange={() => setAccountIds((prev) => toggle(prev, a.id))}
                      size="sm"
                      label={`${a.name} (@${a.handle})`}
                    />
                    <span className="text-[12px] text-foreground truncate">@{a.handle}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Jours
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((label, offset) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setDayOffsets((prev) =>
                        prev.includes(offset)
                          ? prev.filter((d) => d !== offset)
                          : [...prev, offset],
                      )
                    }
                    className={[
                      "px-2.5 py-1 rounded-md text-[12px] border transition-colors",
                      dayOffsets.includes(offset)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-3 w-40">
                <span className="block text-[11px] text-muted-foreground mb-1">
                  Par compte et par jour
                </span>
                <NumberStepper value={perDay} onChange={setPerDay} min={1} max={4} />
              </div>
            </section>

            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Recettes dans lesquelles piocher
              </h3>
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {(context?.pool ?? []).map((p) => (
                  <label
                    key={p.patternTemplateId}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={effectivePool.includes(p.patternTemplateId)}
                      onChange={() =>
                        setPoolIds((prev) => toggle(prev ?? effectivePool, p.patternTemplateId))
                      }
                      size="sm"
                      label={p.label}
                    />
                    <span className="text-[12px] text-foreground truncate">
                      {p.label}
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.accountCount} compte{p.accountCount > 1 ? "s" : ""}
                      </span>
                    </span>
                  </label>
                ))}
                {!loading && (context?.pool.length ?? 0) === 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    Aucune recette auto activée sur ces comptes.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* ── La grille ─────────────────────────────────────────────────── */}
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Chargement…</p>
          ) : (
            <WeekFillGrid
              weekStart={weekStart}
              dayOffsets={[...dayOffsets].sort((a, b) => a - b)}
              accounts={selectedAccounts}
              perDay={perDay}
              occupied={occupied}
              byCell={byCell}
              candidatesByAccount={candidatesByAccount}
              existingUse={context?.existingUse ?? {}}
              onPin={(key, templateId) =>
                setPinned((prev) => ({ ...prev, [key]: templateId }))
              }
            />
          )}

          {proposal.unfilled.some((u) => u.reason === "pool_exhausted_day") && (
            <Alert variant="warning">
              Certaines cases restent vides : toutes les recettes du pool sont déjà posées ce
              jour-là. Cochez plus de recettes, ou publiez moins souvent.
            </Alert>
          )}

          {/* `createSlot` consomme une fiche de bibliothèque de données par
              publication, et supprimer la publication ne la rend pas. */}
          {proposal.assignments.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              Ajustez l&apos;aperçu avant de créer : une publication supprimée après coup ne rend
              pas la fiche de données qu&apos;elle a consommée.
            </p>
          )}
        </div>

        <footer className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <span className="text-[12px] text-muted-foreground">
            {proposal.assignments.length} publication
            {proposal.assignments.length > 1 ? "s" : ""} à créer
            {proposal.unfilled.length > 0 && ` · ${proposal.unfilled.length} case(s) vide(s)`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              loading={creating}
              disabled={proposal.assignments.length === 0}
            >
              Créer les {proposal.assignments.length}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}

/** La grille comptes × jours. Séparée : c'est la moitié du fichier. */
function WeekFillGrid({
  weekStart,
  dayOffsets,
  accounts,
  perDay,
  occupied,
  byCell,
  candidatesByAccount,
  existingUse,
  onPin,
}: {
  weekStart: Date;
  dayOffsets: number[];
  accounts: { id: string; name: string; handle: string }[];
  perDay: number;
  occupied: Set<string>;
  byCell: Map<string, ReturnType<typeof dispatchRecipes>["assignments"][number]>;
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  existingUse: Record<string, RecipeHistory>;
  onPin: (key: string, templateId: string | null) => void;
}) {
  if (accounts.length === 0 || dayOffsets.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Choisissez au moins un compte et un jour.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-card z-10 text-left font-medium text-muted-foreground p-2 w-40">
              Compte
            </th>
            {dayOffsets.map((offset) => (
              <th
                key={offset}
                className="text-left font-medium text-muted-foreground p-2 min-w-[11rem]"
              >
                {DAY_LABELS[offset]} {new Date(dayKeyOf(weekStart, offset)).getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-t border-border align-top">
              <td className="sticky left-0 bg-card z-10 p-2 text-foreground truncate">
                @{account.handle}
              </td>
              {dayOffsets.map((offset) => {
                const dayKey = dayKeyOf(weekStart, offset);
                if (occupied.has(`${account.id}|${dayKey}`)) {
                  return (
                    <td key={offset} className="p-2">
                      <span className="text-muted-foreground/70 text-[11.5px]">
                        déjà programmé
                      </span>
                    </td>
                  );
                }
                return (
                  <td key={offset} className="p-2 space-y-1.5">
                    {Array.from({ length: perDay }, (_, rank) => {
                      const cell = { accountId: account.id, dayKey, rank };
                      const key = cellKey(cell);
                      const assignment = byCell.get(key);
                      const options = rankCandidatesForCell(
                        cell,
                        candidatesByAccount[account.id] ?? [],
                        existingUse,
                      );
                      return (
                        <div key={rank}>
                          <Select
                            value={assignment?.candidate.patternTemplateId ?? ""}
                            onChange={(v) => onPin(key, v || null)}
                            options={[
                              {
                                value: "",
                                // Dire POURQUOI la case est vide : « aucune
                                // recette auto activée sur ce compte » n'est
                                // pas la même chose que « je l'ai vidée ».
                                label:
                                  (candidatesByAccount[account.id] ?? []).length === 0
                                    ? "aucune recette sur ce compte"
                                    : options.length === 0
                                      ? "toutes déjà posées ce jour"
                                      : "— vide —",
                              },
                              ...options.map((o) => ({
                                value: o.candidate.patternTemplateId,
                                label:
                                  o.rawGap === null
                                    ? `${o.candidate.label} · jamais`
                                    : `${o.candidate.label} · ${o.rawGap} j`,
                              })),
                            ]}
                            disabled={options.length === 0 && !assignment}
                          />
                          {assignment && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">
                                {assignment.candidate.publishTime}
                              </span>
                              <Chip size="sm" variant={assignment.pinned ? "sky" : "default"}>
                                {assignment.gapDays === null
                                  ? "jamais servie"
                                  : `il y a ${assignment.gapDays} j`}
                              </Chip>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
