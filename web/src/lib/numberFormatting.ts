export type DecimalSeparator = "," | ".";

type ParsedNumberParts = {
  negative: boolean;
  integer: string;
  fraction: string;
};

export function parseFlexibleNumberParts(value: unknown): ParsedNumberParts | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return parseFlexibleNumberParts(String(value));
  }

  if (typeof value !== "string") return null;

  let raw = value.trim();
  if (!raw) return null;

  raw = raw.replace(/[\s\u202F\u00A0]/g, "");

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  if (!unsigned) return null;

  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);

  let integerPart = unsigned;
  let fractionPart = "";

  if (decimalIndex !== -1) {
    integerPart = unsigned.slice(0, decimalIndex);
    fractionPart = unsigned.slice(decimalIndex + 1);
  }

  const integerDigits = integerPart.replace(/[^\d]/g, "");
  const fractionDigits = fractionPart.replace(/[^\d]/g, "");

  if (!integerDigits && !fractionDigits) return null;

  const normalizedInteger = integerDigits.replace(/^0+(?=\d)/, "") || "0";

  return {
    negative,
    integer: normalizedInteger,
    fraction: fractionDigits,
  };
}

export function toFlexibleNumber(value: unknown): number | null {
  const parts = parseFlexibleNumberParts(value);
  if (!parts) return null;

  const normalized = `${parts.negative ? "-" : ""}${parts.integer}${parts.fraction ? `.${parts.fraction}` : ""}`;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function addThousandsSpacing(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatConfiguredNumber(
  value: unknown,
  options?: {
    formatThousands?: boolean;
    decimalSeparator?: DecimalSeparator;
  }
): string | null {
  const parts = parseFlexibleNumberParts(value);
  if (!parts) return null;

  const decimalSeparator = options?.decimalSeparator ?? ",";
  const integer = options?.formatThousands ? addThousandsSpacing(parts.integer) : parts.integer;
  const fraction = parts.fraction ? `${decimalSeparator}${parts.fraction}` : "";

  return `${parts.negative ? "-" : ""}${integer}${fraction}`;
}