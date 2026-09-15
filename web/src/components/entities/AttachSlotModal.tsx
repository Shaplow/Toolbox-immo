"use client";

import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { localInputToIso } from "@/lib/date/formatFr";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { SOURCE_LABELS_FR } from "@/lib/i18n/glossary";

export interface AttachRecipeOption {
  id: string;
  label: string;
  source: string;
  /**
   * Ce que `id` désigne, donc quel champ poster.
   *
   * Une fiche avec compte propose ses recettes appliquées (`PatternBinding`) ;
   * une fiche sans compte propose les recettes elles-mêmes (`PatternTemplate`).
   * Sans ce discriminant, la modale posterait un id de recette dans le champ
   * réservé aux bindings. Absent = binding, pour le mode « missions » qui, lui,
   * envoie toujours des `recipeIds`.
   */
  kind?: "binding" | "template";
  /** Recette sous-jacente — sert à rattacher l'option à un type de tournage. */
  patternTemplateId?: string;
  /**
   * Types de tournage qui déclenchent cette recette. **Vide = proposée quel que
   * soit le type**, exactement la sémantique `shootTypeId: null` côté commande.
   */
  shootTypeIds?: string[];
}
export interface AttachAccountOption {
  id: string;
  name: string;
  handle: string;
}
export interface AttachShootTypeOption {
  id: string;
  label: string;
  description: string | null;
}

interface AttachSlotModalProps {
  entityId: string;
  entityLabel: string;
  /**
   * Fiche « admin » (ex-Bien) : N recettes lancées d'un coup.
   *
   * `"missions"` est une CLÉ, pas un mot d'écran : le service serveur et la
   * route la renvoient telle quelle (`entityService.attachSlotToEntity`). Le
   * mot « mission » a quitté l'interface — ici on affiche « publications ».
   */
  mode: "missions" | "reel";
  recipes: AttachRecipeOption[];
  accounts?: AttachAccountOption[];
  /** Types de tournage du modèle de commande de la fiche. Vide = pas de choix à offrir. */
  shootTypes?: AttachShootTypeOption[];
  /** Type retenu à la commande — pré-sélection. */
  defaultShootTypeId?: string | null;
  onClose: () => void;
}

/**
 * AttachSlotModal — attache un/des slot(s) à une fiche via
 * `POST /api/entities/[id]/slots`. Fusion de LaunchMissionsModal (fiche
 * admin ex-Bien, N recettes → N missions) et AttachReelModal (fiche team
 * ex-Tournage, 1 reel). Le mode est déterminé par le parent (capacités du
 * type), le service serveur applique le même routage.
 */
export function AttachSlotModal({
  entityId,
  entityLabel,
  mode,
  recipes,
  accounts = [],
  shootTypes = [],
  defaultShootTypeId = null,
  onClose,
}: AttachSlotModalProps) {
  const router = useRouter();
  // Mode missions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState("");
  // Mode reel.
  const [shootTypeId, setShootTypeId] = useState<string>(defaultShootTypeId ?? "");

  // Le type de tournage FILTRE la liste, il ne la contraint pas : c'est une
  // aide à la saisie. L'admin garde le droit d'ajouter une vidéo hors type —
  // le serveur ne vérifie que la source (reel vs auto).
  const visibleRecipes =
    shootTypeId === ""
      ? recipes
      : recipes.filter((r) => !r.shootTypeIds?.length || r.shootTypeIds.includes(shootTypeId));
  // Un type « nombre décidé plus tard » n'a typiquement AUCUNE vidéo attachée —
  // c'est tout son sens. Filtrer dessus rendrait une liste vide ; on retombe
  // alors sur le catalogue complet plutôt que sur un écran sans issue.
  const typeYieldsNothing = shootTypeId !== "" && visibleRecipes.length === 0;
  const effectiveRecipes = typeYieldsNothing ? recipes : visibleRecipes;

  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    if (mode === "missions" && selected.size === 0) {
      setError("Sélectionnez au moins une recette.");
      return;
    }
    if (mode === "reel" && effectiveRecipes.length > 0 && !recipeId) {
      setError("Choisissez une recette.");
      return;
    }
    setSubmitting(true);
    try {
      // En mode reel, l'id sélectionné désigne un binding OU une recette selon
      // que la fiche porte un compte : poster le mauvais champ créerait un slot
      // sans recette, et tout le pipeline en dépend.
      const chosen = recipes.find((r) => r.id === recipeId);
      const body =
        mode === "missions"
          ? { recipeIds: [...selected], accountId: accountId || null }
          : {
              ...(chosen?.kind === "template"
                ? { patternTemplateId: recipeId || null }
                : { patternBindingId: recipeId || null }),
              title: title.trim() || null,
              scheduledAt: scheduledAt ? localInputToIso(scheduledAt) : null,
            };
      const res = await fetch(`/api/entities/${entityId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Échec de l'attache.");
      }
      if (mode === "missions") {
        const { count, failed = [] } = (await res.json()) as {
          count: number;
          failed?: { label: string; error: string }[];
        };
        const detail = failed.map((f) => `${f.label} : ${f.error}`).join(" — ");
        if (count === 0) {
          setError(`Aucune publication créée. ${detail}`);
          return;
        }
        if (failed.length > 0) {
          toast.error(
            `${count} publication${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}, ${failed.length} en échec — ${detail}`,
          );
        } else {
          toast.success(
            `${count} publication${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}.`,
          );
        }
        router.push("/calendar");
      } else {
        toast.success("Reel ajouté");
        onClose();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  const accountOptions = [
    { value: "", label: "Aucun compte — production stock" },
    ...accounts.map((a) => ({ value: a.id, label: `@${a.handle} · ${a.name}` })),
  ];

  return (
    <Modal open onClose={onClose} size="md">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground shrink-0">
            <Clapperboard size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              {mode === "missions" ? "Publications" : "Reel"}
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-foreground">
              {mode === "missions" ? "Lancer des publications" : "Ajouter un reel"}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {mode === "missions"
                ? `Une publication par recette, toutes rattachées à « ${entityLabel} ».`
                : "Le reel démarre directement au montage (les rushs de la fiche sont partagés)."}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {mode === "missions" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recettes
                </span>
                {recipes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Aucune recette disponible.</p>
                ) : (
                  <div className="max-h-64 overflow-auto rounded-md border border-border divide-y divide-border">
                    {recipes.map((r) => (
                      // La Checkbox stoppe la propagation de son propre clic —
                      // pas de double-toggle quand on clique la ligne.
                      <div
                        key={r.id}
                        onClick={() => toggle(r.id)}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50"
                      >
                        <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={r.label} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{r.label}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {SOURCE_LABELS_FR[r.source] ?? r.source}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <FormField
                label="Compte Instagram"
                help="Optionnel. S'applique à toutes les publications créées."
              >
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  options={accountOptions}
                  placeholder="Aucun compte — production stock"
                />
              </FormField>
            </>
          ) : (
            <>
              {/* Le type ne s'affiche que s'il y a un choix à offrir : une fiche
                  hors commande n'en a aucun, et un sélecteur vide poserait une
                  question sans réponse. */}
              {shootTypes.length > 0 && (
                <FormField
                  label="Type de tournage"
                  help="Il détermine les vidéos proposées. « Toutes » lève le filtre."
                >
                  <Select
                    value={shootTypeId}
                    onChange={(v) => {
                      setShootTypeId(v);
                      // La recette choisie peut ne plus être dans la liste : la
                      // garder afficherait un champ vide au-dessus d'un id
                      // invisible, et l'envoi partirait quand même.
                      const stillThere =
                        v === "" ||
                        recipes.some(
                          (r) =>
                            r.id === recipeId &&
                            (!r.shootTypeIds?.length || r.shootTypeIds.includes(v)),
                        );
                      if (!stillThere) setRecipeId("");
                    }}
                    options={[
                      { value: "", label: "Toutes les vidéos du modèle" },
                      ...shootTypes.map((t) => ({ value: t.id, label: t.label })),
                    ]}
                  />
                </FormField>
              )}

              {typeYieldsNothing && (
                <p className="text-[12px] text-muted-foreground">
                  Ce type ne déclenche aucune vidéo prédéfinie — toutes les recettes de montage
                  sont proposées.
                </p>
              )}

              {effectiveRecipes.length > 0 ? (
                <FormField label="Recette" required>
                  <Select
                    value={recipeId}
                    onChange={setRecipeId}
                    options={effectiveRecipes.map((r) => ({ value: r.id, label: r.label }))}
                    placeholder="Choisir une recette…"
                  />
                </FormField>
              ) : (
                <p className="text-[12px] text-warning-700 bg-warning-50 border border-warning-200 rounded-md px-3 py-2">
                  Aucune recette de montage disponible. Créez une recette à rushs ou à envoi externe
                  avant d&apos;ajouter des reels.
                </p>
              )}

              <FormField label="Titre (optionnel)" help="Par défaut : le nom de la recette.">
                <Input value={title} onChange={setTitle} placeholder="Ex : Reel visite salon" />
              </FormField>

              <FormField label="Date de publication (optionnel)" help="Vide = reel en banque (à planifier plus tard).">
                <DateTimeField value={scheduledAt} onChange={setScheduledAt} />
              </FormField>
            </>
          )}

          {error && <p className="text-[12px] text-danger-700">{error}</p>}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              (mode === "missions" ? selected.size === 0 : effectiveRecipes.length === 0)
            }
          >
            {submitting
              ? "Envoi…"
              : mode === "missions"
                ? `Lancer ${selected.size || ""} publication${selected.size > 1 ? "s" : ""}`.replace(
                    "  ",
                    " ",
                  )
                : "Ajouter le reel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
