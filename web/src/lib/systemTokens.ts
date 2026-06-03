const TOKEN_RE = /\{\{maintenant(?::([^}]*))?\}\}/g;

const PATTERN_TOKEN_RE = /EEEE|MMMM|YYYY|MMM|EEE|DD|MM|YY|HH|mm|D|M/g;

const TIME_ZONE = "Europe/Paris";

export type SystemDatePresetKey =
  | "long"
  | "short"
  | "month_year"
  | "month"
  | "month_lower"
  | "day_month"
  | "weekday_day_month"
  | "weekday"
  | "year"
  | "time"
  | "datetime";

export interface SystemDatePresetOption {
  key: SystemDatePresetKey;
  label: string;
}

export const SYSTEM_DATE_PRESETS: SystemDatePresetOption[] = [
  { key: "month_year", label: "Mois année" },
  { key: "month", label: "Mois" },
  { key: "long", label: "Date longue" },
  { key: "short", label: "Date courte" },
  { key: "day_month", label: "Jour mois" },
  { key: "weekday_day_month", label: "Jour de semaine + jour mois" },
  { key: "weekday", label: "Jour de la semaine" },
  { key: "year", label: "Année" },
  { key: "time", label: "Heure" },
  { key: "datetime", label: "Date + heure" },
];

export function resolveSystemTokens(text: string, now: Date = new Date()): string {
  if (!text || text.indexOf("{{maintenant") === -1) return text;
  return text.replace(TOKEN_RE, (_, format: string | undefined) =>
    formatSystemDate(format ?? "", now),
  );
}

export function formatSystemDate(format: string, now: Date = new Date()): string {
  const key = (format ?? "").trim() || "long";
  const preset = PRESETS[key as SystemDatePresetKey];
  if (preset) return preset(now);
  return formatFreePattern(format ?? "", now);
}

export function buildMaintenantToken(format?: string): string {
  return format ? `{{maintenant:${format}}}` : "{{maintenant}}";
}

const PRESETS: Record<SystemDatePresetKey, (d: Date) => string> = {
  long: (d) => `${tk(d, "D")} ${tk(d, "MMMM")} ${tk(d, "YYYY")}`,
  short: (d) => `${tk(d, "DD")}/${tk(d, "MM")}/${tk(d, "YYYY")}`,
  month_year: (d) => `${capitalize(tk(d, "MMMM"))} ${tk(d, "YYYY")}`,
  month: (d) => capitalize(tk(d, "MMMM")),
  month_lower: (d) => tk(d, "MMMM"),
  day_month: (d) => `${tk(d, "D")} ${tk(d, "MMMM")}`,
  weekday_day_month: (d) => `${tk(d, "EEEE")} ${tk(d, "D")} ${tk(d, "MMMM")}`,
  weekday: (d) => tk(d, "EEEE"),
  year: (d) => tk(d, "YYYY"),
  time: (d) => `${tk(d, "HH")}:${tk(d, "mm")}`,
  datetime: (d) =>
    `${tk(d, "DD")}/${tk(d, "MM")}/${tk(d, "YYYY")} ${tk(d, "HH")}:${tk(d, "mm")}`,
};

function formatFreePattern(pattern: string, now: Date): string {
  return pattern.replace(PATTERN_TOKEN_RE, (token) => tk(now, token));
}

function tk(d: Date, token: string): string {
  switch (token) {
    case "EEEE": return part(d, { weekday: "long" }, "weekday");
    case "EEE":  return part(d, { weekday: "short" }, "weekday").replace(/\.$/, "");
    case "MMMM": return part(d, { month: "long" }, "month");
    case "MMM":  return part(d, { month: "short" }, "month").replace(/\.$/, "");
    case "MM":   return part(d, { month: "2-digit" }, "month");
    case "M":    return part(d, { month: "numeric" }, "month");
    case "YYYY": return part(d, { year: "numeric" }, "year");
    case "YY":   return part(d, { year: "2-digit" }, "year");
    case "DD":   return part(d, { day: "2-digit" }, "day");
    case "D":    return part(d, { day: "numeric" }, "day");
    case "HH":   return part(d, { hour: "2-digit", hour12: false }, "hour");
    case "mm":   return part(d, { minute: "2-digit" }, "minute");
    default:     return token;
  }
}

function part(d: Date, opts: Intl.DateTimeFormatOptions, type: string): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, ...opts }).formatToParts(d);
  return parts.find((p) => p.type === type)?.value ?? "";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
