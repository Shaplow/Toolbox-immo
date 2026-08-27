/**
 * Extrait un message d'erreur lisible d'une réponse fetch en échec.
 *
 * Les routes API du projet répondent `{ error: "..." }`, mais certaines
 * relaient le corps d'un service tiers (le render-engine FastAPI répond
 * `{ detail: "..." }`). Sans ce helper, les toasts affichaient le JSON brut —
 * parfois du JSON encapsulé dans du JSON.
 *
 * Ne lève jamais : retombe sur le statut HTTP si le corps est illisible.
 */
export async function readErrorMessage(res: Response, maxLength = 300): Promise<string> {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return `Erreur ${res.status}`;
  }
  if (!raw) return `Erreur ${res.status}`;

  let message = raw;
  for (let depth = 0; depth < 2; depth += 1) {
    try {
      const parsed = JSON.parse(message) as unknown;
      if (typeof parsed === "string") {
        message = parsed;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const candidate = (parsed as { error?: unknown; detail?: unknown; message?: unknown });
        const next = [candidate.error, candidate.detail, candidate.message].find(
          (value): value is string => typeof value === "string",
        );
        if (!next) break;
        message = next;
        continue;
      }
      break;
    } catch {
      break;
    }
  }

  message = message.trim();
  if (!message) return `Erreur ${res.status}`;
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}
