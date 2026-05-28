import { NextResponse } from "next/server";
import { ServiceError } from "./errors";

export function mapServiceError(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  console.error("[service]", err);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}
