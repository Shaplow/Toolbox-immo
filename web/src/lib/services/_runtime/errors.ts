export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
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
