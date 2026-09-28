import { NextResponse } from "next/server";
import { ServiceError } from "./errors";

export function mapServiceError(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    // `details` (ex. { missing } sur MissingFieldsError, { renderId, status }
    // sur RenderInFlightError) est étalé au même niveau que error/code — les
    // routes qui exposaient déjà ces clés à plat (POST /api/listings,
    // POST /api/renders) gardent une réponse compatible.
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.details ?? {}) },
      { status: err.httpStatus },
    );
  }
  console.error("[service]", err);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}
