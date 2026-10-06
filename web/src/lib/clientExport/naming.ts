/**
 * Noms de dossiers et de fichiers écrits chez le client.
 *
 * Pourquoi un module dédié : `sanitizeFileStem` (lib/transcription/batches.ts)
 * ne couvre que ce que Windows interdit dans un ZIP. Ici chaque segment est
 * passé tel quel à `getDirectoryHandle` / `getFileHandle` de Chrome, qui lève un
 * TypeError sur bien plus (caractères de format invisibles comme le ZWJ des
 * emojis ou le BOM, point ou espace en bout de nom, noms de périphériques
 * Windows, desktop.ini…), et le disque qui reçoit les fichiers est celui du
 * client : NTFS et APFS ignorent la casse, macOS et Windows ont chacun leurs
 * interdits. Un seul nom refusé ferait échouer un fichier de plusieurs Gio.
 *
 * Longueurs en unités UTF-16 (`string.length`), l'unité de MAX_PATH sous
 * Windows. Aucune coupe ne sépare une paire de substitution (un emoji).
 *
 * Pur : aucun import serveur (ce module est aussi chargé dans le navigateur).
 */

/**
 * Le texte d'entrée vient d'un humain (nom de compte, de fichier, de Dossier) :
 * il est borné avant tout traitement, pour que le coût reste constant. Tous
 * les appelants tronquent bien en dessous.
 */
const MAX_RAW_LENGTH = 1024;

/** Au-delà, un « .xxx » final n'est pas une extension (« Mr. Smith », « 2024.01.12 vacances »). */
const MAX_EXTENSION_LENGTH = 16;

/** Interdits par Windows et par Chrome dans un nom : `" * / : < > ? \ |`. */
const FORBIDDEN_CHARS = /["*/:<>?\\|]/g;

/**
 * Invisibles que Chrome refuse ou que macOS ignore : contrôles (Cc), formats
 * (Cf : ZWJ des emojis, BOM, marques de direction…), moitiés de paire orphelines
 * (Cs, invalides en UTF-8) et non-caractères Unicode (U+FFFE…). Tous les
 * formats sont supprimés, même ceux que Chrome tolère (ZWJ, ZWNJ) : HFS+ les
 * ignore, et le nom doit rester le même d'un système à l'autre.
 */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/gu;

/**
 * Noms de périphériques Windows (Chrome ajoute clock$), refusés quelle que soit
 * l'extension. Windows réserve aussi COM0/LPT0, les exposants ¹ ² ³ et les
 * poignées de console CONIN$ / CONOUT$.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "clock$",
  "conin$",
  "conout$",
  ...Array.from({ length: 10 }, (_, i) => `com${i}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${i}`),
  "com¹",
  "com²",
  "com³",
  "lpt¹",
  "lpt²",
  "lpt³",
]);

/** Fichiers que l'Explorateur et le Finder interprètent (« Personnaliser le dossier »). */
const RESERVED_FILE_NAMES: ReadonlySet<string> = new Set(["desktop.ini", "thumbs.db"]);

/** Extensions que Windows exécute ou résout (raccourcis, commandes shell) : neutralisées. */
const SHELL_EXTENSIONS: ReadonlySet<string> = new Set(["lnk", "scf", "url", "local"]);

function isJunk(ch: string): boolean {
  return ch === " " || ch === "." || ch === "~";
}

/**
 * Retire espaces, points et « ~ » en tête et en queue, en temps linéaire. Une
 * regex `[ .~]+$` reviendrait en arrière sur chaque suite de points : quadratique
 * (cf. trimDotsAndSpaces dans lib/transcription/batches.ts, ReDoS).
 */
function trimJunk(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isJunk(value[start])) start += 1;
  while (end > start && isJunk(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/**
 * Nettoyage caractère par caractère, sans les règles de nommage (noms réservés,
 * extensions) : sert aux morceaux d'un nom composé (« 2026-10-04 - Visite -
 * Villa »), où seul le nom entier peut être « aux » ou « desktop.ini ».
 */
export function cleanFsaText(raw: string | null | undefined): string {
  if (!raw) return "";
  return trimJunk(
    raw
      .slice(0, MAX_RAW_LENGTH)
      .normalize("NFC")
      // Retour à la ligne et tabulation séparent des mots : espace, pas suppression.
      .replace(/\s+/g, " ")
      .replace(INVISIBLE_CHARS, "")
      .replace(FORBIDDEN_CHARS, "_")
      // Supprimer un invisible entre deux espaces en laisse deux.
      .replace(/\s+/g, " "),
  );
}

/** Préfixe ou suffixe « _ » sur ce que Windows, Chrome ou le shell traiteraient autrement. */
function neutralize(name: string): string {
  if (!name) return name;
  let out = name;

  // Testé sur la partie AVANT LE PREMIER POINT (« aux.mp4 », « Aux. Coulisses »),
  // espaces de queue compris (« aux .txt ») : Windows les ignore.
  const firstDot = out.indexOf(".");
  const head = (firstDot === -1 ? out : out.slice(0, firstDot)).trimEnd().toLowerCase();
  if (RESERVED_DEVICE_NAMES.has(head) || RESERVED_FILE_NAMES.has(out.toLowerCase())) out = `_${out}`;

  const lastDot = out.lastIndexOf(".");
  if (lastDot > 0 && SHELL_EXTENSIONS.has(out.slice(lastDot + 1).toLowerCase())) out = `${out}_`;
  return out;
}

/**
 * Segment de chemin (dossier ou fichier) accepté par Chrome, Windows et macOS.
 * `fallback` sert quand il ne reste rien (« ... », espaces ou invisibles seuls) ;
 * un repli vide est rendu tel quel, l'appelant décidant alors quoi faire d'un
 * nom vide.
 */
export function sanitizeFsaSegment(raw: string | null | undefined, fallback: string): string {
  const cleaned = neutralize(cleanFsaText(raw));
  if (cleaned) return cleaned;
  const fallbackName = neutralize(cleanFsaText(fallback));
  return fallbackName || (fallback ? "_" : "");
}

/** Extension réduite à des lettres, chiffres, « _ » et « - » ; "" si rien n'en reste. */
function cleanExtension(ext: string | null | undefined): string {
  if (!ext) return "";
  return ext
    .slice(0, MAX_EXTENSION_LENGTH)
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

/**
 * Nom de fichier sûr, rendu en (radical, extension). Le radical et l'extension
 * sont nettoyés à part (un point final du radical disparaît avant d'être suivi
 * de l'extension), puis le nom entier repasse par `sanitizeFsaSegment` : seul
 * lui révèle `aux.mp4`, `desktop.ini` ou `raccourci.lnk`. L'extension
 * retournée peut donc porter un « _ » final (`lnk_`).
 */
export function sanitizeFsaFileName(
  stem: string | null | undefined,
  ext: string | null | undefined,
  fallbackStem: string,
): { stem: string; ext: string } {
  const cleanExt = cleanExtension(ext);
  const cleanStem = cleanFsaText(stem) || cleanFsaText(fallbackStem) || "_";
  const full = sanitizeFsaSegment(cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem, "_");
  if (!cleanExt) return { stem: full, ext: "" };
  // L'extension ne contient aucun point : le dernier est celui qui la précède.
  const dot = full.lastIndexOf(".");
  return { stem: full.slice(0, dot), ext: full.slice(dot + 1) };
}

/**
 * Clé de dédoublonnage : APFS et NTFS ignorent la casse (et APFS la forme
 * Unicode), donc « Sarah » et « sarah », ou « é » composé et décomposé,
 * désignent le même fichier. Le repli passe par les majuscules (ß → SS, ı → I)
 * pour ne rater aucune collision : une collision en trop coûte un « (2) », une
 * collision manquée écraserait un fichier.
 */
export function nameKey(name: string): string {
  return name.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
}

/**
 * Sépare un nom de fichier de son extension (sans le point ; "" si absente).
 * Les points de tête ne comptent pas : « .bashrc » n'a pas d'extension, mais
 * « ._IMG_0001.MOV » (fichier de ressources macOS) a bien « MOV ».
 */
export function splitExtension(filename: string): { stem: string; ext: string } {
  let leading = 0;
  while (leading < filename.length && filename[leading] === ".") leading += 1;
  const dot = filename.lastIndexOf(".");
  if (dot < leading || dot === filename.length - 1) return { stem: filename, ext: "" };
  const ext = filename.slice(dot + 1);
  if (ext.length > MAX_EXTENSION_LENGTH || /\s/.test(ext)) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext };
}

/**
 * Octets d'un nom, 255 au plus sur ext4 et APFS (Windows compte en unités
 * UTF-16, déjà bornées par `max`). On en garde 240 : Chrome écrit dans un
 * fichier voisin « <nom>.crswap » (7 octets de plus) avant de le renommer, et
 * il faut garder une marge. Seuls des noms en CJK ou en emojis y touchent,
 * jamais un nom français courant.
 */
const MAX_SEGMENT_BYTES = 240;

/** Octets d'un caractère en UTF-8 ; une moitié de paire orpheline en compte 3 (U+FFFD). */
function utf8Size(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

function utf8Length(value: string): number {
  let total = 0;
  for (const ch of value) total += utf8Size(ch.codePointAt(0) as number);
  return total;
}

/**
 * Plus long début de `name` d'au plus `maxUnits` unités et `maxBytes` octets,
 * coupé entre deux caractères (jamais au milieu d'une paire de substitution),
 * sans point, espace ni « ~ » final. Ne coûte que la longueur gardée, pas celle
 * de `name`.
 */
function truncateWithin(name: string, maxUnits: number, maxBytes: number): string {
  let end = 0;
  let bytes = 0;
  while (end < name.length) {
    const codePoint = name.codePointAt(end) as number;
    const units = codePoint > 0xffff ? 2 : 1;
    const size = utf8Size(codePoint);
    if (end + units > maxUnits || bytes + size > maxBytes) break;
    end += units;
    bytes += size;
  }
  while (end > 0 && isJunk(name[end - 1])) end -= 1;
  if (end === 0) return name.length > 0 ? "_" : "";
  return name.slice(0, end);
}

/**
 * Tronque à `max` unités (>= 1) et à 240 octets UTF-8, sans laisser de point,
 * d'espace ou de « ~ » final ni couper un emoji en deux. Ne laisse jamais un nom
 * vide : « _ » si la coupe a tout emporté.
 */
export function truncateSegment(name: string, max: number): string {
  return truncateWithin(name, Math.max(1, Math.floor(max)), MAX_SEGMENT_BYTES);
}

/**
 * Nom de fichier d'au plus `max` : l'extension est gardée entière, le radical
 * est tronqué (un caractère au minimum, quitte à dépasser `max` si l'extension
 * seule le dépasse). Même plafond en octets que `truncateSegment`, extension
 * comprise. `tail` est un texte placé entre le radical et l'extension, gardé
 * entier lui aussi (« (2) » d'un homonyme, « - ab12cd » d'une publication) :
 * c'est le radical qui cède la place.
 */
export function truncateFileName(stem: string, ext: string, max: number, tail = ""): string {
  const fixed = `${tail}${ext ? `.${ext}` : ""}`;
  const kept = truncateWithin(
    stem,
    Math.max(1, max - fixed.length),
    Math.max(1, MAX_SEGMENT_BYTES - utf8Length(fixed)),
  );
  return `${kept || "_"}${fixed}`;
}

/**
 * Prochain numéro à essayer pour un nom déjà pris : sans cette mémoire, N
 * homonymes coûteraient N²/2 essais (« video.mp4 » ×10 000 = 50 M de clés).
 * Un simple point de départ : chaque essai est revérifié dans `taken`.
 */
const nextSuffixHints = new WeakMap<Set<string>, Map<string, number>>();

/**
 * Rend `candidate` unique parmi `taken` (ensemble de CLÉS `nameKey`, pas de
 * noms bruts : la comparaison ignore la casse) et enregistre le résultat. Un
 * homonyme devient « nom (2) », « nom (3) »… ; pour un fichier, le numéro se
 * place AVANT l'extension. Avec `max`, le radical est raccourci pour que le
 * nom suffixé tienne toujours dedans, en unités comme en octets (le budget de
 * chemin ne dépend pas du nombre d'homonymes).
 */
export function dedupeName(
  candidate: string,
  taken: Set<string>,
  opts: { isFile?: boolean; max?: number } = {},
): string {
  const key = nameKey(candidate);
  if (!taken.has(key)) {
    taken.add(key);
    return candidate;
  }

  const { stem, ext } = opts.isFile ? splitExtension(candidate) : { stem: candidate, ext: "" };
  const hints = nextSuffixHints.get(taken) ?? new Map<string, number>();
  nextSuffixHints.set(taken, hints);

  for (let n = hints.get(key) ?? 2; ; n += 1) {
    const suffix = ` (${n})`;
    const next =
      opts.max === undefined
        ? `${stem}${suffix}${ext ? `.${ext}` : ""}`
        : truncateFileName(stem, ext, opts.max, suffix);
    const nextKey = nameKey(next);
    if (taken.has(nextKey)) continue;
    taken.add(nextKey);
    hints.set(key, n + 1);
    return next;
  }
}
