/**
 * seed-presets.ts — Upsert des presets captions builtin + import template Vitrine
 *
 * Usage :
 *   cd web
 *   npx tsx scripts/seed-presets.ts
 *
 * Prérequis : un compte admin doit exister (username "Mathis" ou rôle ADMIN).
 * Les presets captions sont créés sans userId (builtin global).
 * Le template Vitrine est assigné au premier admin trouvé.
 */

import { PrismaClient } from "@prisma/client";

const VITRINE_TEMPLATE = {
  id: "cmm0q97v10001kn6gqgzc1jqy",
  name: "Vitrine",
  client: "Bonjour Oscar",
  formats: '["A3_LANDSCAPE"]',
  jsonData: `{"canvas":{"format":"A3_LANDSCAPE","width":1587,"height":1123,"dpi":300,"marginTop":40,"marginRight":40,"marginBottom":40,"marginLeft":40,"bleed":0,"backgroundColor":"#FFFFFF"},"theme":{"palette":{"primary":"#151f36","secondary":"#003288","accent":"#C9A84C","background":"#FFFFFF","text":"#1A1A1A","textLight":"#6B6B6B"},"fonts":{"heading":{"family":"Playfair Display","fallback":"Georgia, serif","weights":[400,700]},"body":{"family":"Montserrat","fallback":"Arial, sans-serif","weights":[300,400,600]}},"defaultStyles":{"title":{"fontFamily":"Playfair Display","fontSize":32,"fontWeight":700,"color":"#1A1A1A","lineHeight":1.2,"letterSpacing":0},"body":{"fontFamily":"Montserrat","fontSize":14,"fontWeight":400,"color":"#1A1A1A","lineHeight":1.5,"letterSpacing":0},"legal":{"fontFamily":"Montserrat","fontSize":8,"fontWeight":300,"color":"#6B6B6B","lineHeight":1.4,"letterSpacing":0}},"customFonts":[{"family":"harmonyos sans bold","url":"/fonts/harmonyos-sans-bold.ttf"},{"family":"Oswald Regular","url":"/fonts/Oswald-Regular.ttf"},{"family":"Oswald RegularItalic 400","url":"/fonts/Oswald_RegularItalic_400.ttf"},{"family":"BebasNeue Regular","url":"/fonts/BebasNeue-Regular.ttf"}]},"blocks":[{"id":"8n096evb","x":0,"y":0,"w":1590,"h":890,"z":10,"animations":[],"type":"image","fit":"cover","locked":true,"binding":"photo_appartement"},{"id":"0mv7i4ts","x":1110,"y":-310,"w":1060,"h":540,"z":11,"animations":[],"type":"image","fit":"contain","staticSrc":"/uploads/1772033765102-slpa5qya3r9.png","locked":true},{"id":"op26hvgq","x":454,"y":885,"w":680,"h":170,"z":10,"animations":[],"type":"text","style":{"fontSize":110,"color":"#151f36","textAlign":"center","fontFamily":"BebasNeue Regular","verticalAlign":"middle"},"rules":{"uppercase":true,"maxLines":1},"binding":"prix","locked":true,"content":"{{prix}} €"},{"id":"s65zj5ix","x":454,"y":1034,"w":680,"h":50,"z":10,"animations":[],"type":"text","style":{"fontSize":24,"color":"#003288","textAlign":"center","fontFamily":"harmonyos sans bold"},"rules":{"uppercase":true,"maxLines":1},"locked":true,"binding":"arrondissement - rue","content":"{{arrondissement}} - {{rue}}"},{"id":"uedbnwrc","x":452,"y":1079,"w":680,"h":30,"z":10,"animations":[],"type":"text","style":{"fontSize":11,"color":"#151f36","textAlign":"center","fontFamily":"Oswald Regular"},"rules":{"maxLines":1,"uppercase":false},"locked":true,"binding":"infos_supplementaires","content":"Honoraires charges {{honoraires_type}}{{#if is_copro == oui}} - Nbre lots copropriété : {{nbre_lots}} - Charges annuelles : {{charges_annuelles}}€{{/if}}{{#if has_procedures == non}} - Pas de procédures en cours{{/if}}{{#if has_procedures == oui}} - Procédures en cours{{/if}}"},{"id":"xq6prmet","x":0,"y":890,"w":1590,"h":250,"z":8,"animations":[],"type":"shape","shape":"rectangle","fillColor":"#f3f3f3","borderRadius":0,"locked":true},{"id":"wy5q93vz","x":90,"y":940,"w":180,"h":130,"z":10,"animations":[],"type":"image","fit":"contain","staticSrc":"/uploads/1772041960613-tu4ho0wv2dg.png","locked":true},{"id":"sjc7fycg","x":130,"y":960,"w":94,"h":30,"z":10,"animations":[],"type":"text","style":{"fontSize":16,"color":"#1A1A1A","verticalAlign":"middle","fontFamily":"harmonyos sans bold"},"rules":{},"binding":"m²","content":"{{surface}} m²","locked":true},{"id":"text-1772057437673","x":130,"y":1020,"w":104,"h":30,"z":11,"animations":[],"type":"text","style":{"fontSize":16,"color":"#1A1A1A","verticalAlign":"middle","fontFamily":"harmonyos sans bold"},"rules":{},"binding":"m²","content":"{{sdb}} sdb","locked":true},{"id":"text-1772116476164","x":280,"y":1020,"w":160,"h":28,"z":12,"animations":[],"type":"text","style":{"fontSize":16,"color":"#1A1A1A","verticalAlign":"middle","fontFamily":"harmonyos sans bold"},"rules":{},"binding":"m²","content":"{{pieces}} pièce(s)","locked":true},{"id":"text-1772116551477","x":280,"y":960,"w":162,"h":32,"z":13,"animations":[],"type":"text","style":{"fontSize":16,"color":"#1A1A1A","verticalAlign":"middle","fontFamily":"harmonyos sans bold"},"rules":{},"binding":"m²","content":"{{chambres}} chambre(s)","locked":true},{"id":"s2wypvdt","x":1410,"y":926,"w":173,"h":166,"z":10,"animations":[],"type":"dpe","variant":"climate","style":{},"locked":true},{"id":"lmijxmrb","x":1144,"y":926,"w":254,"h":166,"z":10,"animations":[],"type":"dpe","variant":"energy","style":{},"locked":true},{"id":"b2n1fzwq","x":-210,"y":-192,"w":728,"h":706,"z":11,"animations":[],"type":"image","fit":"cover","staticSrc":"/uploads/1772375968708-msqt2rlap1m.png","showIf":{"field":"bandeau","equals":"vendu"}},{"id":"image-1772377432026","x":-210,"y":-192,"w":728,"h":706,"z":12,"animations":[],"type":"image","fit":"cover","staticSrc":"/uploads/1772377441989-i51um1waq3j.png","showIf":{"field":"bandeau","equals":"sous-promesse"}}],"groups":[],"schema":[{"key":"photo_appartement","label":"Photo de l'appartement","type":"image","required":true},{"key":"prix","label":"Prix du bien","type":"text","required":true,"placeholder":"980 000","description":"Entrer uniquement le nombre, avec un espace (exemple : 980 000) "},{"key":"rue","label":"Rue / Avenue","type":"text","required":true,"placeholder":"avenue des champs"},{"key":"arrondissement","label":"Arrondissement","type":"text","required":true,"placeholder":"paris xvii","description":"Suivre ce formatage : PARIS XVII / PARIS VIII / etc."},{"key":"sdb","label":"Nbr de salle de bain","type":"number","required":true,"placeholder":"2","description":"Entrer uniquement le nombre de salle de bain que possède le bien"},{"key":"pieces","label":"Nbr de pièces","type":"number","required":true,"placeholder":"3","description":"Entrer uniquement le nombre de pièces que possède le bien"},{"key":"chambres","label":"Nbr de chambres","type":"text","required":true,"placeholder":"3","description":"Entrer uniquement le nombre de pièces que possède le bien"},{"key":"surface","label":"Surface","type":"number","required":true,"placeholder":"130","description":"Entrer uniquement le nombre (surface en m²)"},{"key":"honoraires_type","label":"Type d'honoraires","type":"select","required":true,"options":["vendeur","acquéreur"]},{"key":"is_copro","label":"Est-ce une co-proriété ?","type":"select","required":true,"options":["oui","non"],"description":"Laissez vide si non"},{"key":"nbre_lots","label":"Nombre de lots","type":"number","required":false,"showIf":{"field":"is_copro","equals":"oui"}},{"key":"charges_annuelles","label":"Montant des charges annuelles","type":"number","required":true},{"key":"has_procedures","label":"Procédures en cours ?","type":"select","required":true,"options":["non","oui"],"description":"Champ conditionnel"}]}`,
};

const prisma = new PrismaClient();

const PRESETS = [
  {
    name: "Bonjour Oscar",
    config: {
      base: { font: "Bebas Neue", size_ratio: 0.037037037037037035, bold: false, italic: false, text_transform: "upper", color: "#FFFFFF", spacing: 5 },
      highlight: { font: "Bebas Neue", size_ratio: 0.046296296296296294, bold: false, italic: false, text_transform: "upper", color: "#ffffff", spacing: 0 },
      highlight2: { enabled: true, font: "Playfair Display Italic", size_ratio: 0.05555555555555555, bold: false, italic: false, text_transform: "lower", color: "#efa94d", spacing: 0 },
      layout: { anchor: "center", max_lines: 2, line_gap: -0.19999999999999996, max_width_ratio: 0.6, vertical_offset: 0.17, safe_left: 0.06, safe_right: 0.06, safe_top: 0.08, safe_bottom: 0.18, auto_safe_area: true },
      effects: {
        shadow_enabled: true, shadow_distance: 0, shadow_blur: 15, shadow_angle: 0, shadow_alpha: 0.1, shadow_color: "#000000",
        shadow_targets: { base: true, highlight: true, highlight2: true },
        glow_enabled: true, glow_color: "#FFFFFF", glow_color_auto: true,
        glow_targets: { base: false, highlight: true, highlight2: true },
        glow_intensity: 2,
        outline_enabled: false, outline_color: "#000000", outline_width: 3,
        outline_targets: { base: true, highlight: true, highlight2: true },
      },
      animation: "appear", animation_enabled: true, export_profile: "final", preview_time: 0,
      highlight_enabled: false, highlight_keywords: "",
    },
  },
  {
    name: "S de la Grandiere",
    config: {
      base: { font: "HarmonyOS Sans Bold", size_ratio: 0.027777777777777776, bold: false, italic: false, text_transform: "upper", color: "#f6dc93", spacing: 0 },
      highlight: { font: "Didot", size_ratio: 0.068, bold: false, italic: false, text_transform: "none", color: "#c88b3a", spacing: 0 },
      highlight2: { enabled: false, font: "Didot", size_ratio: 0.068, bold: false, italic: true, text_transform: "none", color: "#3ab8c8", spacing: 0 },
      layout: { anchor: "center", max_lines: 1, line_gap: 0, max_width_ratio: 0.6, vertical_offset: 0.15, safe_left: 0.06, safe_right: 0.06, safe_top: 0.08, safe_bottom: 0.18, auto_safe_area: true },
      effects: {
        shadow_enabled: true, shadow_distance: 10, shadow_blur: 0, shadow_angle: 40, shadow_alpha: 0.9, shadow_color: "#000000",
        shadow_targets: { base: true, highlight: false, highlight2: false },
        glow_enabled: false, glow_color: "#c88b3a", glow_color_auto: false,
        glow_targets: { base: true, highlight: true, highlight2: true },
        glow_intensity: 0,
        outline_enabled: true, outline_color: "#000000", outline_width: 7.5,
        outline_targets: { base: true, highlight: false, highlight2: false },
      },
      animation: "word_pop", animation_enabled: true, export_profile: "final", preview_time: 2,
      highlight_enabled: false, highlight_keywords: "",
    },
  },
];

// async function main() {
//   console.log("🌱 Seed presets captions builtin...\n");
//
//   for (const { name, config } of PRESETS) {
//     await prisma.captionPreset.deleteMany({ where: { name, isBuiltin: true, userId: null } });
//     await prisma.captionPreset.create({
//       data: { name, userId: null, isBuiltin: true, config: JSON.stringify(config) },
//     });
//     console.log(`✅ Preset "${name}" créé`);
//   }
//
//   // ── Template Vitrine Bonjour Oscar ──────────────────────────────────────────
//   const admin = await prisma.user.findFirst({ where: { username: "Mathis" } });
//   if (!admin) {
//     console.warn("\n⚠️  Utilisateur 'Mathis' introuvable — template Vitrine non importé.");
//     console.warn("   Crée d'abord le compte admin puis relance ce script.");
//   } else {
//     await prisma.templateAccess.deleteMany({ where: { templateId: VITRINE_TEMPLATE.id } });
//     await prisma.template.deleteMany({ where: { id: VITRINE_TEMPLATE.id } });
//
//     const template = await prisma.template.create({
//       data: { ...VITRINE_TEMPLATE, userId: admin.id },
//     });
//     console.log(`\n✅ Template importé : "${template.name}" — ${template.client}`);
//
//     await prisma.templateAccess.create({
//       data: { userId: admin.id, templateId: template.id },
//     });
//     console.log(`✅ Accès template assigné à ${admin.name ?? admin.email}`);
//   }
//
//   console.log("\n🎉 Done !");
//
//   await seedDerushPresets(prisma);
// }
//
// main()
//   .catch((e) => { console.error("❌", e); process.exit(1); })
//   .finally(() => prisma.$disconnect());

// ─── Derush builtin presets ───────────────────────────────────────────────────

const DERUSH_PRESETS: { name: string; analysisMode: string; config: object }[] = [
  {
    name: "beauty",
    analysisMode: "vision",
    config: {
      scoring_weights: {
        sharpness: 0.35,
        stability: 0.25,
        exposure: 0.20,
        composition: 0.15,
        duration_score: 0.02,
        visual_interest: 0.02,
        diversity: 0.01,
      },
      reject_thresholds: {
        min_duration: 0.5,
        min_sharpness: 20,
        max_shake: 8,
      },
      export_defaults: {
        format: "clips_trimmed",
        workflow: "capcut",
        accurate_trim: false,
      },
      description:
        "Sélection orientée qualité visuelle (beauté immobilière) : netteté, stabilité et exposition priorisées. Idéal pour les biens haut de gamme.",
    },
  },
  {
    name: "content_relevance",
    analysisMode: "transcription",
    config: {
      scoring_weights: {
        sharpness: 0.05,
        stability: 0.05,
        exposure: 0.05,
        composition: 0.05,
        duration_score: 0.20,
        visual_interest: 0.10,
        diversity: 0.50,
      },
      reject_thresholds: {
        min_duration: 1.0,
        min_sharpness: 5,
        max_shake: 25,
      },
      export_defaults: {
        format: "xml_timeline",
        workflow: "premiere",
        accurate_trim: false,
      },
      description:
        "Sélection orientée contenu éditorial (podcast, interview) : favorise les segments CONTENT avec un scoring basé sur la diversité et la durée.",
    },
  },
  {
    name: "action",
    analysisMode: "vision",
    config: {
      scoring_weights: {
        sharpness: 0.20,
        stability: 0.05,
        exposure: 0.10,
        composition: 0.10,
        duration_score: 0.30,
        visual_interest: 0.20,
        diversity: 0.05,
      },
      reject_thresholds: {
        min_duration: 0.3,
        min_sharpness: 8,
        max_shake: 40,
      },
      export_defaults: {
        format: "clips_trimmed",
        workflow: "capcut",
        accurate_trim: true,
      },
      description:
        "Sélection pour contenus dynamiques (visite rapide, reportage) : tolérance au mouvement élevée, favorise les plans longs et visuellement intéressants.",
    },
  },
  {
    name: "balanced",
    analysisMode: "vision",
    config: {
      scoring_weights: {
        sharpness: 0.25,
        stability: 0.20,
        exposure: 0.15,
        composition: 0.15,
        duration_score: 0.10,
        visual_interest: 0.10,
        diversity: 0.05,
      },
      reject_thresholds: {
        min_duration: 0.8,
        min_sharpness: 15,
        max_shake: 10,
      },
      export_defaults: {
        format: "clips_trimmed",
        workflow: "capcut",
        accurate_trim: false,
      },
      description:
        "Sélection équilibrée — paramètres par défaut. Convient à la plupart des tournages immobiliers.",
    },
  },
];

async function seedDerushPresets(prismaClient: PrismaClient) {
  console.log("\n🌱 Seed presets derush builtin...\n");
  for (const { name, analysisMode, config } of DERUSH_PRESETS) {
    await prismaClient.derushPreset.upsert({
      where: {
        // We'll use a composite-like check (name + isBuiltin) — no unique on name,
        // so we deleteMany first then create instead, same as caption presets above.
        id: `builtin-derush-${name}`,
      },
      create: {
        id: `builtin-derush-${name}`,
        name,
        userId: null,
        isBuiltin: true,
        analysisMode,
        config: JSON.stringify(config),
      },
      update: {
        config: JSON.stringify(config),
        analysisMode,
      },
    });
    console.log(`✅ Derush preset "${name}" (${analysisMode}) upsert`);
  }
}

// ─── Derush Formats ──────────────────────────────────────────────────────────

const DERUSH_FORMATS = [
  {
    id: "builtin-format-rqr",
    slug: "rqr",
    name: "RQR (Réponses aux Questions Rapides)",
    description: "Format immobilier avec questions et réponses courtes. Regroupe chaque Q+R en un seul clip.",
    contextPrompt:
      "Ce contenu est une vidéo immobilière au format RQR (Réponses aux Questions Rapides). " +
      "Chaque séquence utile est une question posée par le vendeur suivie d'une réponse directe. " +
      "La qualité immobilière des termes est primordiale : corrige les noms de quartiers, arrondissements, " +
      "adresses, et termes techniques (DPE, PTZ, loi Carrez…). " +
      "Preserve le phrasé naturel et les formulations courtes typiques de ce format.",
    silenceThreshold: 3.0,
    exportMode: "qa_pair",
  },
  {
    id: "builtin-format-talking-head",
    slug: "talking_head",
    name: "Talking Head",
    description: "Interview ou monologue face caméra. Découpe sur les pauses naturelles.",
    contextPrompt:
      "Ce contenu est une vidéo immobilière de type talking head (face caméra). " +
      "Le locuteur parle directement à la caméra. Corrige les termes techniques immobiliers " +
      "(noms de villes, quartiers, DPE, surface loi Carrez, charges de copropriété…) " +
      "tout en préservant le style oral naturel. Ne reformule pas les phrases.",
    silenceThreshold: 0,
    exportMode: "individual",
  },
  {
    id: "builtin-format-podcast",
    slug: "podcast",
    name: "Podcast / Interview",
    description: "Deux interlocuteurs ou plus. Silences plus longs acceptés entre les répliques.",
    contextPrompt:
      "Ce contenu est un podcast ou une interview immobilière avec plusieurs interlocuteurs. " +
      "Les échanges peuvent être longs. Corrige les noms propres (agences, villes, quartiers), " +
      "les chiffres importants (prix, surface, taux) et les sigles immobiliers (DPE, BBC, VEFA…). " +
      "Ne reformule pas ; corrige uniquement les erreurs de transcription manifestes.",
    silenceThreshold: 0,
    exportMode: "individual",
  },
  {
    id: "builtin-format-vrai-faux",
    slug: "vrai_faux",
    name: "Vrai ou Faux",
    description: "Affirmations courtes évaluées par un expert. Découpe serrée sur chaque assertion.",
    contextPrompt:
      "Ce contenu est une vidéo immobilière au format Vrai ou Faux. " +
      "Chaque séquence est une affirmation suivie d'une validation ou correction par un expert. " +
      "Les segments doivent être courts et précis. Corrige les termes techniques immobiliers " +
      "et les chiffres réglementaires (délais légaux, plafonds PTZ, seuils DPE…).",
    silenceThreshold: 0,
    exportMode: "individual",
  },
];

async function seedDerushFormats(prismaClient: PrismaClient) {
  console.log("\n🌱 Seed formats derush builtin...\n");
  for (const { id, slug, name, description, contextPrompt, silenceThreshold, exportMode } of DERUSH_FORMATS) {
    await prismaClient.derushFormat.upsert({
      where: { slug },
      create: {
        id,
        slug,
        name,
        description,
        contextPrompt,
        silenceThreshold,
        exportMode,
        isBuiltin: true,
        userId: null,
      },
      update: {
        name,
        description,
        contextPrompt,
        silenceThreshold,
        exportMode,
      },
    });
    console.log(`✅ Derush format "${name}" (${slug}) upsert`);
  }
}

// Auto-run if called directly (not via main seed.ts import)
if (require.main === module) {
  Promise.resolve()
    // .then(() => seedDerushPresets(prisma))
    .then(() => seedDerushFormats(prisma))
    .then(() => console.log("\n✅ Derush formats seeded!"))
    .catch((e) => { console.error("❌", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

export { seedDerushPresets, seedDerushFormats };
