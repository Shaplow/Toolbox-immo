/**
 * bulkRenderService.ts — aperçu et lancement des rendus en lot depuis le
 * calendrier (plan « lancer les rendus depuis le calendrier », étape 6).
 *
 * Principe directeur (voir le plan) : le lot doit faire EXACTEMENT ce que
 * ferait le formulaire de génération lancé une publication après l'autre,
 * dans l'ordre du calendrier, sans être touché. Deux briques posées par les
 * étapes précédentes rendent ça possible sans dupliquer la logique :
 *  - `batchUsage` (étape 3) : registre d'usage virtuel — chaque pick d'une
 *    ligne déjà traitée compte comme "vient d'être servi" pour les lignes
 *    suivantes du même lot, sans jamais écrire en base.
 *  - `generationFormModel` (étape 4) : même chaîne buildMergedSchema →
 *    buildSlotPrefill → ... → finalSchema que `/generate/[templateId]`,
 *    donc les MÊMES statuts « champ requis manquant » / « select
 *    metadata-driven vide » (RVA4) que le formulaire produirait.
 *
 * `previewBulkRenders` ne réserve rien nulle part : le registre en mémoire
 * disparaît avec la requête. `launchBulkRenders` ne retire JAMAIS un pick —
 * les items reçus sont les picks EXACTS validés côté client (aperçu,
 * éventuellement modifiés via « Changer ») ; décocher une ligne ne doit pas
 * décaler les suivantes.
 */

import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import {
  ForbiddenError,
  ValidationError,
  ServiceError,
  MissingFieldsError,
  RenderInFlightError,
} from "@/lib/services/_runtime/errors";
import { normalizeTemplateJSON } from "@/lib/templateNormalization";
import type {
  TemplateJSON,
  MusicBlock,
  MediaSelectionRule,
  MediaSelectionRuleConfig,
  TagCondition,
} from "@/types/template";
import type { LibraryFieldMeta } from "@/types/libraryPrefill";
import {
  slotEffectivePatternSelect,
  resolveSlotEffectivePattern,
  type SlotWithEffectivePattern,
  type SlotEffectivePattern,
} from "@/lib/services/slot/effectivePattern";
import { requiresEntity } from "@/lib/publications/entityRequirement";
import { isReservedSetTag } from "@/lib/rotation/sentinels";
import { isRendered } from "@/lib/slots/renderEligibility";
import { TERMINAL_STATUSES } from "@/types/roles";
import { createBatchUsageLedger, batchUsageKey, type BatchUsageLedger } from "@/lib/rotation/batchUsage";
import {
  buildGenerationFormModel,
  projectFormValues,
  templateUsesLibrary,
  findEmptyMetadataDrivenSelects,
  type GenerationFormModel,
} from "@/lib/generate/generationFormModel";
import {
  findMissingRequiredFields,
  createListingForRender,
  createAndStartRender,
  withSlotRenderLock,
  findInFlightRender,
} from "@/lib/services/render/renderLaunchService";
import type { LibraryPrefill } from "@/lib/contentLibraryResolver";
import { resolveTagConditionsForForm } from "@/lib/generate/libraryAssetsQuery";
import {
  estimateSequenceDuration,
  estimateSingleVideoDuration,
  resolveRequiredAudioDuration,
} from "@/lib/generate/estimateOutputDuration";
import { buildRenderRequestBody } from "@/lib/generate/buildRenderRequestBody";
import { PROVENANCE_KEY } from "@/lib/generate/provenance";
import {
  BULK_RENDER_CAP,
  type BulkRenderPreview,
  type BulkRenderRow,
  type BulkRenderIgnoredReason,
  type BulkRenderMedia,
  type BulkRenderData,
  type BulkRenderLaunchItem,
  type BulkRenderLaunchResult,
  type BulkRenderLaunchResponse,
  type BulkRenderLaunchErrorCode,
} from "@/types/bulkRender";

// ─── Admin only ───────────────────────────────────────────────────────────
// Même motif que `bulkPatchSlots`/`bulkMarkPublishedSlots` (slotService.ts) :
// `canAdminBypass` vaut false en impersonation, donc un CM/MONTEUR usurpé ne
// peut pas déclencher un lot de rendus depuis le calendrier admin.
function assertAdmin(ctx: UserContext): void {
  if (!ctx.canAdminBypass) {
    throw new ForbiddenError("Réservé aux administrateurs");
  }
}

// ─── Erreur interne de ligne (lancement) ──────────────────────────────────
// Jamais exportée : sert uniquement à porter un `BulkRenderLaunchErrorCode`
// jusqu'au catch par-item de `launchBulkRenders`.
class BulkRenderRowError extends Error {
  constructor(
    public readonly code: BulkRenderLaunchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BulkRenderRowError";
  }
}

// ─── Helpers de lecture du template ────────────────────────────────────────

/** Premier MusicBlock lié à une bibliothèque — même règle que `resolveLibraryPrefill`. */
function findMusicBlock(json: TemplateJSON): MusicBlock | undefined {
  return json.blocks.find((b): b is MusicBlock => b.type === "music" && !!b.libraryId);
}

/** Mirror minimal de `extractTagRuleMeta` (buildLibraryPrefillContext.ts, privée) —
 *  seul le nécessaire pour peupler `BulkRenderMedia.picker`. */
function extractTagMeta(rule: MediaSelectionRule | undefined): {
  tagFilterParam?: string;
  tagFilter?: string;
  tagConditions?: TagCondition[];
  tagConditionsOperator?: "AND" | "OR";
} {
  if (typeof rule !== "object" || rule === null) return {};
  const cfg = rule as MediaSelectionRuleConfig;
  return {
    tagFilterParam: cfg.tagFilterParam,
    tagFilter: cfg.tagFilter,
    tagConditions: cfg.tagConditions,
    tagConditionsOperator: cfg.tagConditionsOperator,
  };
}

function buildPicker(
  meta: { tagFilterParam?: string; tagFilter?: string; tagConditions?: TagCondition[]; tagConditionsOperator?: "AND" | "OR"; minDuration?: number },
  values: Record<string, unknown>,
  accountId: string | undefined,
): BulkRenderMedia["picker"] {
  const resolvedConditions = resolveTagConditionsForForm(meta.tagConditions, values);
  return {
    tagFilter: meta.tagFilterParam ? String(values[meta.tagFilterParam] ?? "") : undefined,
    tagFilterLiteral: meta.tagFilter,
    tagConditions: resolvedConditions.length > 0 ? resolvedConditions : undefined,
    tagConditionsOperator: meta.tagConditionsOperator,
    minDuration: meta.minDuration,
    accountId,
  };
}

/**
 * Plancher de durée effectif d'un pick audio — le plus grand des deux entre
 * `minDuration` du bloc et la borne calculée par le résolveur à partir de la
 * vidéo réellement tirée (`resolveRequiredAudioDuration`, propagée jusqu'ici
 * via `model.audioMinDuration`). Sans ce combiné, le picker « Changer »
 * proposerait des pistes plus courtes que ce que le tirage automatique
 * aurait accepté (fix unbound-music-duration-floor-dropped).
 */
function combineAudioMinDuration(blockMinDuration: number | undefined, resolverFloor: number | undefined): number | undefined {
  const floor = Math.max(blockMinDuration ?? 0, resolverFloor ?? 0);
  return floor > 0 ? floor : undefined;
}

/** Libellé de repli d'un bloc/slot vidéo ou musique — name du block, ou label/binding du slot séquence. */
function buildBlockLabelFallback(json: TemplateJSON): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of json.blocks) {
    if (b.name) map.set(b.id, b.name);
  }
  for (const s of json.videoSequence ?? []) {
    map.set(s.id, s.label ?? s.binding ?? s.id);
  }
  return map;
}

/** `contentLibrary.dataLibraryId` direct, ou résolu via `dataCampaignId` —
 *  même cascade que `resolveLibraryPrefill` (contentLibraryResolver.ts). */
async function resolveTemplateDataLibraryId(json: TemplateJSON): Promise<string | undefined> {
  const direct = json.contentLibrary?.dataLibraryId;
  if (direct) return direct;
  const campaignId = json.contentLibrary?.dataCampaignId;
  if (!campaignId) return undefined;
  const campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId }, select: { libraryId: true } });
  return campaign?.libraryId ?? undefined;
}

// ─── Chargement des slots (select partagé preview/launch) ─────────────────

const bulkSlotSelect = {
  id: true,
  scheduledAt: true,
  status: true,
  accountId: true,
  entityId: true,
  createdAt: true,
  account: { select: { id: true, handle: true } },
  render: { select: { status: true } },
  renders: { orderBy: { createdAt: "desc" as const }, take: 1, select: { status: true } },
  ...slotEffectivePatternSelect,
};

type BulkSlot = SlotWithEffectivePattern & {
  id: string;
  scheduledAt: Date | null;
  status: string;
  accountId: string | null;
  entityId: string | null;
  createdAt: Date;
  account: { id: string; handle: string } | null;
  render: { status: string } | null;
  renders: { status: string }[];
};

function compareForBulk(a: BulkSlot, b: BulkSlot): number {
  if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (a.scheduledAt) return -1;
  if (b.scheduledAt) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// ════════════════════════════════════════════════════════════════════════
// previewBulkRenders
// ════════════════════════════════════════════════════════════════════════

export async function previewBulkRenders(slotIds: string[], ctx: UserContext): Promise<BulkRenderPreview> {
  assertAdmin(ctx);

  const dedupedIds = Array.from(new Set(slotIds));
  const slots = (await prisma.publicationSlot.findMany({
    where: { id: { in: dedupedIds } },
    select: bulkSlotSelect,
  })) as unknown as BulkSlot[];

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const ignoredCounts = new Map<BulkRenderIgnoredReason, number>();
  const bumpIgnored = (reason: BulkRenderIgnoredReason) =>
    ignoredCounts.set(reason, (ignoredCounts.get(reason) ?? 0) + 1);

  for (const id of dedupedIds) {
    if (!slotById.has(id)) bumpIgnored("not_found");
  }

  // Pattern effectif calculé une fois par slot, réutilisé partout ensuite.
  const patternBySlotId = new Map<string, SlotEffectivePattern | null>();
  const candidates: BulkSlot[] = [];

  for (const slot of slots) {
    const pattern = resolveSlotEffectivePattern(slot);
    patternBySlotId.set(slot.id, pattern);

    if (!pattern || pattern.source !== "auto_template") {
      bumpIgnored("not_auto_template");
      continue;
    }
    if ((TERMINAL_STATUSES as readonly string[]).includes(slot.status)) {
      bumpIgnored("terminal_status");
      continue;
    }
    if (isRendered({ status: slot.status, render: slot.render, latestRender: slot.renders[0] ?? null })) {
      bumpIgnored("already_rendered");
      continue;
    }
    candidates.push(slot);
  }

  candidates.sort(compareForBulk);
  const capped = candidates.slice(0, BULK_RENDER_CAP);
  const deferred = candidates.length - capped.length;

  // Templates des candidats retenus — un seul findMany, un seul JSON.parse
  // par templateId (jamais réutilisé muté : `buildGenerationFormModel` clone
  // avant toute relaxation de champ).
  const templateIds = Array.from(
    new Set(
      capped
        .map((s) => patternBySlotId.get(s.id)?.templateId ?? null)
        .filter((id): id is string => !!id),
    ),
  );
  const templateRows = templateIds.length > 0
    ? await prisma.template.findMany({ where: { id: { in: templateIds } }, select: { id: true, name: true, jsonData: true } })
    : [];
  const templateRowById = new Map(templateRows.map((t) => [t.id, t]));

  // Cache par templateId : plusieurs lignes du lot partagent souvent le même
  // template (même recette sur plusieurs comptes) — évite de refaire le
  // findUnique DataCampaign→libraryId (resolveTemplateDataLibraryId) à chaque
  // ligne.
  const dataLibraryIdByTemplateId = new Map<string, string | undefined>();
  async function resolveDataLibraryIdCached(templateId: string, json: TemplateJSON): Promise<string | undefined> {
    if (dataLibraryIdByTemplateId.has(templateId)) return dataLibraryIdByTemplateId.get(templateId);
    const id = await resolveTemplateDataLibraryId(json);
    dataLibraryIdByTemplateId.set(templateId, id);
    return id;
  }

  const ledger = createBatchUsageLedger();
  const rows: BulkRenderRow[] = [];

  // Ramassés au fil des lignes `ready`, enrichis en une seule passe finale
  // (findMany asset + findMany bibliothèque média/data) — jamais de N+1.
  const pendingAssetIds = new Set<string>();
  const pendingMediaLibraryIds = new Set<string>();
  // Index dans `rows` → dataLibraryId — patché en une seule passe finale,
  // sans re-résoudre dataCampaignId ni exposer de champ interne sur
  // `BulkRenderData` (contrat public de `types/bulkRender.ts`).
  const dataLibraryIdByRowIndex = new Map<number, string>();

  for (const slot of capped) {
    const pattern = patternBySlotId.get(slot.id)!; // source === auto_template garanti (filtré ci-dessus)
    const account = slot.account ? { id: slot.account.id, handle: slot.account.handle } : null;
    const overdue = !!slot.scheduledAt && slot.scheduledAt.getTime() < Date.now();
    const formHref = pattern.templateId ? `/generate/${pattern.templateId}?slotId=${slot.id}` : null;

    const baseRow = {
      slotId: slot.id,
      scheduledAt: slot.scheduledAt ? slot.scheduledAt.toISOString() : null,
      overdue,
      account,
      recipeLabel: pattern.label,
      templateId: pattern.templateId,
      templateName: pattern.templateId ? templateRowById.get(pattern.templateId)?.name ?? null : null,
      formHref,
    };

    if (!pattern.templateId) {
      rows.push({ ...baseRow, status: "no_template", reason: "Recette sans template associé", media: [], data: null });
      continue;
    }

    // In-flight : partagé avec le formulaire unitaire et le lancement —
    // récupère aussi les orphelins (process redémarré) au passage.
    const inFlight = await findInFlightRender(slot.id);
    if (inFlight) {
      rows.push({ ...baseRow, status: "in_flight", reason: "Rendu en cours", media: [], data: null });
      continue;
    }

    const templateRow = templateRowById.get(pattern.templateId);
    if (!templateRow) {
      rows.push({ ...baseRow, status: "no_template", reason: "Template introuvable", media: [], data: null });
      continue;
    }
    let json: TemplateJSON;
    try {
      json = normalizeTemplateJSON(JSON.parse(templateRow.jsonData) as TemplateJSON);
    } catch {
      rows.push({ ...baseRow, status: "no_template", reason: "Template illisible", media: [], data: null });
      continue;
    }

    if (templateUsesLibrary(json) && !slot.accountId) {
      rows.push({ ...baseRow, status: "no_account", reason: "Compte Instagram requis", media: [], data: null });
      continue;
    }

    if (requiresEntity(pattern) && !slot.entityId) {
      rows.push({ ...baseRow, status: "needs_property", reason: "Choix du bien requis", media: [], data: null });
      continue;
    }

    const model = await buildGenerationFormModel({
      json,
      slotId: slot.id,
      accountId: slot.accountId,
      batchUsage: ledger,
    });

    if (findEmptyMetadataDrivenSelects(model.finalSchema, model.initialValues).length > 0) {
      // RVA4 : select metadata-driven resté vide après pré-remplissage — le
      // choix du bien (fiche) tranchera cette valeur en amont, plus tard.
      //
      // Volontairement sur `model.initialValues`, PAS sur les valeurs projetées
      // (qui appliqueraient `field.default`) : un select encore vide ne doit
      // JAMAIS se voir substituer une valeur par défaut du schéma pour passer
      // ce garde-fou — ce serait choisir un bien à la place de l'admin. Le
      // vrai bug (un `default` qui traîne sur un select metadata-driven après
      // un changement de source dans le builder) se corrige dans le builder,
      // pas ici. Même check, à l'identique, au lancement (launchOne).
      rows.push({ ...baseRow, status: "needs_property", reason: "Choix du bien requis", media: [], data: null });
      continue;
    }

    // Miroir de la règle de lancement (launchOne) : un template avec
    // DataLibrary mais sans entrée résolue (rule 'manual', rotationMode
    // 'none', pool épuisé…) ne doit PAS sortir 'ready' juste parce que les
    // champs texte sont optionnels — `findMissingRequiredFields` ne voit pas
    // ce cas puisqu'aucun champ requis n'est vide. Sans ce miroir, la ligne
    // partait 'ready' à l'aperçu puis échouait systématiquement au lancement
    // (`missing_fields`, ligne jamais lançable depuis la modale).
    const templateDataLibraryId = await resolveDataLibraryIdCached(pattern.templateId, json);
    if (templateDataLibraryId && !model.context?.dataSuggestion) {
      rows.push({
        ...baseRow,
        status: "incomplete",
        reason: "Fiche de données indisponible",
        missingFields: ["Fiche de données"],
        media: [],
        data: null,
      });
      continue;
    }

    const { values } = projectFormValues(model);
    const missing = findMissingRequiredFields({ json: model.json, values, finalSchema: model.finalSchema });
    if (missing.length > 0) {
      rows.push({
        ...baseRow,
        status: "incomplete",
        reason: `Champs manquants : ${missing.join(", ")}`,
        missingFields: missing,
        media: [],
        data: null,
      });
      continue;
    }

    // ── Ligne prête : construit media[]/data, puis inscrit les picks
    // APPLIQUÉS au registre — jamais avant d'avoir statué "ready", sinon une
    // ligne RVA4/incomplète intercalée consommerait quand même un pick.
    const { media, data, dataLibraryId } = await buildReadyRowMedia({
      json,
      model,
      values,
      slotAccountId: slot.accountId,
      ledger,
      pendingAssetIds,
      pendingMediaLibraryIds,
    });
    if (dataLibraryId) dataLibraryIdByRowIndex.set(rows.length, dataLibraryId);

    rows.push({ ...baseRow, status: "ready", media, data });
  }

  // ── Enrichissement final (posterUrl/duration/setTag + noms de bibliothèque) ──
  const assetRows = pendingAssetIds.size > 0
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: Array.from(pendingAssetIds) } },
        select: { id: true, posterUrl: true, duration: true, setTag: true },
      })
    : [];
  const assetInfoById = new Map(assetRows.map((a) => [a.id, a]));

  const mediaLibraryRows = pendingMediaLibraryIds.size > 0
    ? await prisma.mediaLibrary.findMany({ where: { id: { in: Array.from(pendingMediaLibraryIds) } }, select: { id: true, name: true } })
    : [];
  const mediaLibraryNameById = new Map(mediaLibraryRows.map((l) => [l.id, l.name]));

  const dataLibraryIds = Array.from(new Set(dataLibraryIdByRowIndex.values()));
  const dataLibraryRows = dataLibraryIds.length > 0
    ? await prisma.dataLibrary.findMany({ where: { id: { in: dataLibraryIds } }, select: { id: true, name: true } })
    : [];
  const dataLibraryNameById = new Map(dataLibraryRows.map((l) => [l.id, l.name]));

  rows.forEach((row, idx) => {
    if (row.status !== "ready") return;
    row.media = row.media.map((m) => ({
      ...m,
      libraryName: mediaLibraryNameById.get(m.libraryId) ?? null,
      asset: m.asset
        ? {
            ...m.asset,
            posterUrl: assetInfoById.get(m.asset.id)?.posterUrl ?? null,
            duration: assetInfoById.get(m.asset.id)?.duration ?? null,
            setTag: isReservedSetTag(assetInfoById.get(m.asset.id)?.setTag) ? null : assetInfoById.get(m.asset.id)?.setTag ?? null,
          }
        : null,
    }));
    const dataLibraryId = dataLibraryIdByRowIndex.get(idx);
    if (row.data && dataLibraryId) {
      row.data = { ...row.data, libraryName: dataLibraryNameById.get(dataLibraryId) ?? null };
    }
  });

  const ignored = Array.from(ignoredCounts.entries()).map(([reason, count]) => ({ reason, count }));

  return { rows, ignored, deferred, cap: BULK_RENDER_CAP };
}

/**
 * Construit `media[]`/`data` d'une ligne `ready` ET inscrit au registre les
 * picks réellement appliqués (fieldLibraryMap + musique non bindée +
 * DataEntry) — jamais les blocs sans suggestion.
 */
async function buildReadyRowMedia(args: {
  json: TemplateJSON;
  model: GenerationFormModel;
  values: Record<string, unknown>;
  slotAccountId: string | null;
  ledger: BatchUsageLedger;
  pendingAssetIds: Set<string>;
  pendingMediaLibraryIds: Set<string>;
}): Promise<{ media: BulkRenderMedia[]; data: BulkRenderData | null; dataLibraryId: string | null }> {
  const { json, model, values, slotAccountId, ledger, pendingAssetIds, pendingMediaLibraryIds } = args;
  const ctx = model.context;
  const labelFallback = buildBlockLabelFallback(json);
  const media: BulkRenderMedia[] = [];

  if (ctx) {
    // Fix alias-fieldkey-double-ledger-record / ledger-double-record-same-block :
    // un slot de séquence SANS binding, relié via `videoBlockId` à un bloc qui,
    // lui, a un binding (layout RVA3/RVA4 — ex. slot "CONTENT" relié au bloc
    // "rva3raw"), pose DEUX clés dans `fieldLibraryMap` pour le MÊME blockId
    // (cf. `buildLibraryPrefillContext.ts`, `setFieldLibraryMapEntry`). Boucler
    // sur toutes les entrées poussait deux cellules media et appelait
    // `ledger.record` deux fois pour un seul asset réellement claimé au submit
    // (`buildUsedAssets` clé par blockId) — le registre virtuel comptait alors
    // 2 usages pour 1, et le burn-once excluait l'asset après une seule ligne.
    // On regroupe par blockId et on ne garde qu'UNE entrée, en préférant la clé
    // présente dans `finalSchema` (le champ visible du formulaire) pour le
    // label/fieldKey exposés.
    const entriesByBlockId = new Map<string, [string, LibraryFieldMeta][]>();
    for (const entry of Object.entries(ctx.fieldLibraryMap)) {
      const blockId = entry[1].blockId;
      const list = entriesByBlockId.get(blockId) ?? [];
      list.push(entry);
      entriesByBlockId.set(blockId, list);
    }

    // Fix metadata-driven-swap-dropped : un slot de séquence relié à un select
    // `metadata-values-from-library` (RVA3/RVA4 — choix du bien) voit son
    // média re-résolu au lancement DEPUIS LA VALEUR DU SELECT, quel que soit
    // le pick reçu dans `videoAssets` — un « Changer » y serait donc ignoré.
    // On repère ces blockIds via `ctx.metadataDrivenLinks` pour marquer la
    // cellule `locked` (l'UI masque « Changer », le lancement refuse un
    // `changedBlockIds` qui les cible).
    const metadataLockedBlockIds = new Set(
      (ctx.metadataDrivenLinks ?? [])
        .map((link) => ctx.fieldLibraryMap[link.targetFieldKey]?.blockId)
        .filter((id): id is string => !!id),
    );

    for (const [, entries] of entriesByBlockId) {
      const preferred = entries.find(([fieldKey]) => model.finalSchema.some((f) => f.key === fieldKey)) ?? entries[0];
      const [fieldKey, meta] = preferred;
      const suggestion = ctx.initialSuggestions[fieldKey] ?? null;
      const pickKey = meta.type === "video" ? `video:${meta.blockId}` : "audio";
      const effectiveUsageKey = model.usageKeyByPick?.[pickKey]?.usageKey ?? null;
      const schemaField = model.finalSchema.find((f) => f.key === fieldKey);
      // Fix unbound-music-duration-floor-dropped : pour une entrée audio BOUND
      // (champ musique du formulaire), le plancher affiché au picker « Changer »
      // doit lui aussi tenir compte de la durée vidéo estimée par le résolveur,
      // pas seulement de `musicBlock.minDuration`.
      const pickerMinDuration = meta.type === "audio"
        ? combineAudioMinDuration(meta.minDuration, model.audioMinDuration)
        : meta.minDuration;

      media.push({
        blockId: meta.blockId,
        fieldKey,
        label: schemaField?.label || labelFallback.get(meta.blockId) || meta.blockId,
        kind: meta.type,
        libraryId: meta.libraryId,
        libraryName: null,
        usageKey: batchUsageKey(meta.libraryId, effectiveUsageKey),
        picker: buildPicker({ ...meta, minDuration: pickerMinDuration }, values, slotAccountId ?? undefined),
        asset: suggestion ? { id: suggestion.id, url: suggestion.url, filename: suggestion.filename, posterUrl: null, duration: null, setTag: null } : null,
        ...(metadataLockedBlockIds.has(meta.blockId) ? { locked: true as const } : {}),
      });
      pendingMediaLibraryIds.add(meta.libraryId);
      if (suggestion) {
        ledger.record(meta.libraryId, effectiveUsageKey, suggestion.id);
        pendingAssetIds.add(suggestion.id);
      }
    }
  }

  // Musique sans binding : jamais dans fieldLibraryMap (pas de champ de
  // formulaire) — le rendu l'honore quand même via `usedAssets.audioAssetId`
  // (prefillAudioAssetId, generateRender.ts).
  //
  // Fix unbound-music-duration-floor-dropped / unbound-music-ignores-video-duration :
  // avant, cette fonction re-tirait ICI un asset avec `selectMediaAsset(...,
  // musicBlock.minDuration, ...)` — un second tirage qui IGNORAIT la durée de
  // la vidéo réellement résolue par le lot. `buildGenerationFormModel` a déjà
  // fait tirer ce pick par `resolveLibraryPrefill`, avec la BONNE borne
  // (`resolveRequiredAudioDuration(musicBlock, estimate)`, `estimate` construit
  // depuis les vidéos du lot) — on le récupère au lieu de re-tirer, comme le
  // fait déjà la branche bound ci-dessus via `ctx.initialSuggestions`.
  const musicBlock = findMusicBlock(json);
  const musicLibraryId = musicBlock?.libraryId;
  if (musicBlock && musicLibraryId && !musicBlock.binding) {
    const picked = model.unboundAudioSuggestion ?? null;
    const pickedUsageKey = model.usageKeyByPick?.audio?.usageKey ?? null;
    const tagMeta = extractTagMeta(musicBlock.audioSelectionRule);
    const pickerMinDuration = combineAudioMinDuration(musicBlock.minDuration, model.audioMinDuration);
    media.push({
      blockId: musicBlock.id,
      fieldKey: null,
      label: musicBlock.name || "Musique",
      kind: "audio",
      libraryId: musicLibraryId,
      libraryName: null,
      usageKey: batchUsageKey(musicLibraryId, pickedUsageKey),
      picker: buildPicker({ ...tagMeta, minDuration: pickerMinDuration }, values, slotAccountId ?? undefined),
      asset: picked ? { id: picked.id, url: picked.url, filename: picked.filename, posterUrl: null, duration: null, setTag: null } : null,
    });
    pendingMediaLibraryIds.add(musicLibraryId);
    if (picked) {
      ledger.record(musicLibraryId, pickedUsageKey, picked.id);
      pendingAssetIds.add(picked.id);
    }
  }

  let data: BulkRenderData | null = null;
  let dataLibraryId: string | null = null;
  if (ctx?.dataSuggestion) {
    const dataMeta = model.usageKeyByPick?.data;
    if (dataMeta) ledger.record(dataMeta.libraryId, dataMeta.usageKey, ctx.dataSuggestion.entryId);
    const fields = Object.values(ctx.dataSuggestion.fields).filter((v) => v && v.trim());
    const rawExcerpt = fields.join(" · ");
    const excerpt = rawExcerpt.length > 80 ? `${rawExcerpt.slice(0, 79)}…` : rawExcerpt;
    const setTag = isReservedSetTag(ctx.dataSuggestion.resolvedSetTag) ? null : ctx.dataSuggestion.resolvedSetTag ?? null;
    data = {
      entryId: ctx.dataSuggestion.entryId,
      libraryName: null,
      setTag,
      excerpt,
      usageKey: batchUsageKey(dataMeta?.libraryId ?? "", dataMeta?.usageKey ?? null),
    };
    dataLibraryId = dataMeta?.libraryId ?? null;
  }

  return { media, data, dataLibraryId };
}

// ════════════════════════════════════════════════════════════════════════
// launchBulkRenders
// ════════════════════════════════════════════════════════════════════════

export async function launchBulkRenders(
  items: BulkRenderLaunchItem[],
  ctx: UserContext,
): Promise<BulkRenderLaunchResponse> {
  assertAdmin(ctx);

  const deduped: BulkRenderLaunchItem[] = [];
  const seenSlotIds = new Set<string>();
  for (const item of items) {
    if (seenSlotIds.has(item.slotId)) continue;
    seenSlotIds.add(item.slotId);
    deduped.push(item);
  }

  if (deduped.length > BULK_RENDER_CAP) {
    throw new ValidationError(`Au plus ${BULK_RENDER_CAP} rendus par lot`);
  }

  const results: BulkRenderLaunchResult[] = [];
  for (const item of deduped) {
    try {
      const result = await withSlotRenderLock(item.slotId, () => launchOne(item, ctx));
      results.push(result);
    } catch (err) {
      results.push(toLaunchResult(item.slotId, err));
    }
  }
  return { results };
}

function toLaunchResult(slotId: string, err: unknown): BulkRenderLaunchResult {
  if (err instanceof RenderInFlightError) return { slotId, ok: false, code: "in_flight", error: err.message };
  if (err instanceof MissingFieldsError) return { slotId, ok: false, code: "missing_fields", error: err.message };
  if (err instanceof BulkRenderRowError) return { slotId, ok: false, code: err.code, error: err.message };
  if (err instanceof ServiceError) return { slotId, ok: false, code: "error", error: err.message };
  return { slotId, ok: false, code: "error", error: err instanceof Error ? err.message : "Erreur inconnue" };
}

async function launchOne(item: BulkRenderLaunchItem, ctx: UserContext): Promise<BulkRenderLaunchResult> {
  const slot = (await prisma.publicationSlot.findUnique({
    where: { id: item.slotId },
    select: bulkSlotSelect,
  })) as unknown as BulkSlot | null;
  if (!slot) throw new BulkRenderRowError("not_eligible", "Publication introuvable");

  const pattern = resolveSlotEffectivePattern(slot);
  if (!pattern || pattern.source !== "auto_template" || !pattern.templateId) {
    throw new BulkRenderRowError("not_eligible", "Cette publication n'a pas de recette de génération auto avec template.");
  }
  // Capturé en local : évite de dépendre de la préservation du narrowing de
  // `pattern.templateId` par TS à travers les nombreux `await` qui suivent.
  const templateId: string = pattern.templateId;
  if ((TERMINAL_STATUSES as readonly string[]).includes(slot.status)) {
    throw new BulkRenderRowError("not_eligible", "Publication déjà au statut terminal.");
  }
  if (isRendered({ status: slot.status, render: slot.render, latestRender: slot.renders[0] ?? null })) {
    throw new BulkRenderRowError("not_eligible", "Cette publication est déjà rendue.");
  }

  const inFlight = await findInFlightRender(slot.id);
  if (inFlight) throw new RenderInFlightError({ renderId: inFlight.id, status: inFlight.status });

  const templateRow = await prisma.template.findUnique({ where: { id: templateId }, select: { jsonData: true } });
  if (!templateRow) throw new BulkRenderRowError("not_eligible", "Template introuvable.");
  let json: TemplateJSON;
  try {
    json = normalizeTemplateJSON(JSON.parse(templateRow.jsonData) as TemplateJSON);
  } catch {
    throw new BulkRenderRowError("not_eligible", "Template illisible.");
  }

  if (templateUsesLibrary(json) && !slot.accountId) {
    throw new BulkRenderRowError("not_eligible", "Compte Instagram requis pour ce template.");
  }
  if (requiresEntity(pattern) && !slot.entityId) {
    throw new BulkRenderRowError("not_eligible", "Choix du bien requis pour cette recette.");
  }

  // ── Modèle "à blanc" (resolvedPrefill vide) — donne fieldLibraryMap SANS
  // tirer quoi que ce soit (jamais de redraw au lancement). Sert uniquement
  // à connaître les blocIds/bibliothèques AUTORISÉS pour valider les picks.
  const emptyPrefill: LibraryPrefill = {
    videoSuggestions: {},
    audioSuggestion: null,
    dataSuggestion: null,
    setSequencedLibraryIds: [],
    usedSetTagByLibrary: {},
  };
  const dryModel = await buildGenerationFormModel({
    json,
    slotId: slot.id,
    accountId: slot.accountId,
    resolvedPrefill: emptyPrefill,
  });
  const fieldLibraryMap: Record<string, LibraryFieldMeta> = dryModel.context?.fieldLibraryMap ?? {};

  // Fix metadata-driven-swap-dropped : un blockId lié à un select
  // `metadata-values-from-library` (RVA3/RVA4) est re-résolu au rendu DEPUIS
  // LA VALEUR DU SELECT — un « Changer » reçu dans `changedBlockIds` pour ce
  // blockId serait donc silencieusement ignoré. On le refuse explicitement
  // plutôt que de laisser l'aperçu rendre un média différent de celui montré.
  const metadataLockedBlockIds = new Set(
    (dryModel.context?.metadataDrivenLinks ?? [])
      .map((link) => fieldLibraryMap[link.targetFieldKey]?.blockId)
      .filter((id): id is string => !!id),
  );
  for (const blockId of item.changedBlockIds ?? []) {
    if (metadataLockedBlockIds.has(blockId)) {
      throw new BulkRenderRowError("invalid_asset", "Ce média est imposé par le choix du bien.");
    }
  }

  const allowedVideoLibraryByBlockId = new Map<string, string>();
  let boundAudioLibraryId: string | undefined;
  for (const meta of Object.values(fieldLibraryMap)) {
    if (meta.type === "video") allowedVideoLibraryByBlockId.set(meta.blockId, meta.libraryId);
    else boundAudioLibraryId = meta.libraryId;
  }
  const musicBlock = findMusicBlock(json);
  const unboundAudioLibraryId = musicBlock && !boundAudioLibraryId ? musicBlock.libraryId : undefined;
  const allowedAudioLibraryId = boundAudioLibraryId ?? unboundAudioLibraryId;

  // ── Validation des picks vidéo/audio — un seul findMany ────────────────
  for (const blockId of Object.keys(item.videoAssets ?? {})) {
    if (!allowedVideoLibraryByBlockId.has(blockId)) {
      throw new BulkRenderRowError("invalid_asset", `Bloc vidéo "${blockId}" inconnu de ce template.`);
    }
  }
  if (item.audioAssetId && !allowedAudioLibraryId) {
    throw new BulkRenderRowError("invalid_asset", "Ce template n'attend pas de musique de bibliothèque.");
  }

  const candidateAssetIds = Array.from(
    new Set([...Object.values(item.videoAssets ?? {}), ...(item.audioAssetId ? [item.audioAssetId] : [])]),
  );
  const assetRows = candidateAssetIds.length > 0
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: candidateAssetIds } },
        // `duration` : nécessaire au garde-fou de durée musique ci-dessous
        // (fix unbound-music-duration-floor-dropped / unbound-music-ignores-video-duration).
        select: { id: true, libraryId: true, disabled: true, url: true, filename: true, duration: true },
      })
    : [];
  const assetById = new Map(assetRows.map((a) => [a.id, a]));

  const videoSuggestions: LibraryPrefill["videoSuggestions"] = {};
  for (const [blockId, assetId] of Object.entries(item.videoAssets ?? {})) {
    const expectedLibraryId = allowedVideoLibraryByBlockId.get(blockId);
    const row = assetById.get(assetId);
    if (!row || row.libraryId !== expectedLibraryId || row.disabled) {
      throw new BulkRenderRowError("invalid_asset", `Vidéo choisie invalide pour le bloc "${blockId}".`);
    }
    videoSuggestions[blockId] = { id: row.id, url: row.url, filename: row.filename };
  }

  let audioSuggestion: LibraryPrefill["audioSuggestion"] = null;
  let unboundAudioAssetId: string | null = null;
  if (item.audioAssetId) {
    const row = assetById.get(item.audioAssetId);
    if (!row || row.libraryId !== allowedAudioLibraryId || row.disabled) {
      throw new BulkRenderRowError("invalid_asset", "Musique choisie invalide.");
    }
    audioSuggestion = { id: row.id, url: row.url, filename: row.filename };
    if (unboundAudioLibraryId && !boundAudioLibraryId) unboundAudioAssetId = row.id;

    // Fix unbound-music-duration-floor-dropped / unbound-music-ignores-video-duration
    // (garde côté lancement) : recalcule le MÊME plancher que le résolveur
    // (`minDuration` du bloc OU durée vidéo estimée, le plus grand des deux —
    // `undefined` si la piste boucle, cf. `resolveRequiredAudioDuration`) à
    // partir des vidéos réellement choisies dans cet item, et rejette une
    // piste trop courte. Ne re-tire JAMAIS un pick — vérifie seulement celui
    // fourni.
    if (musicBlock && row.duration != null && row.duration > 0) {
      const seq = json.videoSequence ?? [];
      const durationForBlockId = (blockId: string): number | null =>
        assetById.get(videoSuggestions[blockId]?.id ?? "")?.duration ?? null;
      const estimate = seq.length > 0
        ? estimateSequenceDuration(
            seq.map((s) => ({ id: s.id, assetDuration: durationForBlockId(s.id), cap: s.maxDuration })),
            json.canvas?.maxDuration,
          )
        : estimateSingleVideoDuration(
            Object.keys(videoSuggestions).map((blockId) => ({ id: blockId, assetDuration: durationForBlockId(blockId) })),
            json.canvas?.maxDuration,
          );
      const floor = resolveRequiredAudioDuration(musicBlock, estimate);
      if (floor && row.duration < floor) {
        throw new BulkRenderRowError(
          "invalid_asset",
          `Musique trop courte pour cette vidéo (minimum ${Math.ceil(floor)}s).`,
        );
      }
    }
  }

  // ── Validation de la fiche de données (DataEntry) — jamais de redraw ───
  const dataLibraryId = await resolveTemplateDataLibraryId(json);
  let dataSuggestion: LibraryPrefill["dataSuggestion"] = null;
  if (dataLibraryId && !item.dataEntryId) {
    throw new MissingFieldsError(["Fiche de données"]);
  }
  if (item.dataEntryId) {
    if (!dataLibraryId) {
      throw new BulkRenderRowError("invalid_data_entry", "Ce template n'attend pas de fiche de données.");
    }
    const entry = await prisma.dataEntry.findUnique({
      where: { id: item.dataEntryId },
      select: { id: true, libraryId: true, fields: true, setTag: true, accesses: { select: { accountId: true } } },
    });
    if (!entry || entry.libraryId !== dataLibraryId) {
      throw new BulkRenderRowError("invalid_data_entry", "Fiche de données invalide pour ce template.");
    }
    if (entry.accesses.length > 0 && (!slot.accountId || !entry.accesses.some((a) => a.accountId === slot.accountId))) {
      throw new BulkRenderRowError("invalid_data_entry", "Fiche de données non accessible pour ce compte.");
    }
    let fields: Record<string, string> = {};
    try {
      fields = JSON.parse(entry.fields) as Record<string, string>;
    } catch {
      fields = {};
    }
    dataSuggestion = { entryId: entry.id, fields, resolvedSetTag: entry.setTag };
  }

  const resolvedPrefill: LibraryPrefill = {
    videoSuggestions,
    audioSuggestion,
    dataSuggestion,
    setSequencedLibraryIds: [],
    usedSetTagByLibrary: {},
  };

  const model = await buildGenerationFormModel({
    json,
    slotId: slot.id,
    accountId: slot.accountId,
    resolvedPrefill,
  });

  // Fix launch-skips-empty-metadata-select-gate : la preview refuse déjà une
  // ligne dont le select metadata-driven (RVA4, choix du bien) est resté vide
  // (bulkRenderService.ts, previewBulkRenders). Sans ce même garde ICI, un
  // item envoyé après que l'entité/l'override du slot a changé entre
  // l'aperçu et le lancement (ou un body construit à la main) passait quand
  // même : le champ vidéo lié est relaxé (`required: false`,
  // `generationFormModel.ts`) donc `findMissingRequiredFields` ne le voit
  // pas — un Listing/Render partait sans bien choisi.
  //
  // Sur `model.initialValues`, PAS sur les valeurs projetées : même raison
  // qu'à l'aperçu (voir le commentaire de `previewBulkRenders`) — un select
  // vide ne doit jamais être masqué par un `field.default`.
  if (findEmptyMetadataDrivenSelects(model.finalSchema, model.initialValues).length > 0) {
    throw new BulkRenderRowError("not_eligible", "Choix du bien requis pour cette recette.");
  }

  // blockIds changés (« Changer ») → fieldKeys (provenance "manual"), via le
  // fieldLibraryMap du modèle RÉEL (identique au modèle à blanc côté clés).
  const fieldKeyByBlockId = new Map<string, string>();
  for (const [fieldKey, meta] of Object.entries(model.context?.fieldLibraryMap ?? {})) {
    fieldKeyByBlockId.set(meta.blockId, fieldKey);
  }
  const changedFieldKeys = (item.changedBlockIds ?? [])
    .map((blockId) => fieldKeyByBlockId.get(blockId))
    .filter((k): k is string => !!k);

  const { values, provenance } = projectFormValues(model, changedFieldKeys);
  const missing = findMissingRequiredFields({ json: model.json, values, finalSchema: model.finalSchema });
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const listing = await createListingForRender(
    { templateId, data: { ...values, [PROVENANCE_KEY]: provenance } },
    ctx,
  );

  const body = buildRenderRequestBody({
    templateId,
    listingId: listing.id,
    accountId: slot.accountId,
    slotId: slot.id,
    context: model.context,
    selections: model.context?.initialSuggestions ?? {},
    provenance,
  });
  // Musique sans binding : jamais dans `fieldLibraryMap`, donc jamais dans
  // `selections` ni dans le `usedAssets` que `buildRenderRequestBody` vient
  // de construire — fusionné après coup, comme le formulaire ne le ferait
  // JAMAIS tout seul (il n'a pas de champ pour ça), mais comme le rendu
  // l'attend (`prefillAudioAssetId`, generateRender.ts).
  if (unboundAudioAssetId) {
    body.usedAssets = { ...(body.usedAssets ?? {}), audioAssetId: unboundAudioAssetId };
  }

  const render = await createAndStartRender(body, ctx, { lockHeld: true });
  return { slotId: item.slotId, ok: true, renderId: render.id };
}
