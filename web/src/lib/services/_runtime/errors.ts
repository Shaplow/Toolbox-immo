export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    /** Champs additionnels étalés dans le body JSON par mapServiceError, à côté de error/code. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends ServiceError {
  constructor(resource = "Ressource") {
    super("NOT_FOUND", `${resource} introuvable`, 404);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "Permission refusée") {
    super("FORBIDDEN", message, 403);
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super("VALIDATION", message, 400);
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = "Non autorisé") {
    super("UNAUTHORIZED", message, 401);
  }
}

/**
 * Champs obligatoires du template vides après pré-remplissage — même message
 * que l'ancien check inline de `POST /api/listings`. `missing` porte les
 * libellés (label || key) des champs concernés, dédupliqués.
 */
export class MissingFieldsError extends ServiceError {
  constructor(missing: string[]) {
    super("MISSING_FIELDS", "Champs obligatoires manquants", 422, { missing });
  }
}

/**
 * Un rendu PENDING/PROCESSING existe déjà pour ce slot — même message que
 * l'ancien 409 inline de `POST /api/renders`. `renderId`/`status` sont omis
 * quand l'appelant ne les connaît pas encore (ex. verrou en mémoire déjà pris).
 */
export class RenderInFlightError extends ServiceError {
  constructor(details: { renderId?: string; status?: string } = {}) {
    super("RENDER_IN_FLIGHT", "Un rendu est déjà en cours pour ce slot.", 409, details);
  }
}
