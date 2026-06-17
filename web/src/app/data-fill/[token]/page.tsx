/**
 * /data-fill/[token] — page publique de remplissage de DataLibrary.
 *
 * Phase 1.x Vague 3. Accessible SANS authentification : le token est l'auth.
 * L'externe voit le schéma de la lib + un form pour soumettre des fiches.
 * Il ne voit JAMAIS les fiches existantes (anti-leak basique).
 */

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { DataFillForm } from "./DataFillForm";

type PageProps = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Remplir une bibliothèque de données",
  robots: { index: false, follow: false },
};

export default async function DataFillPage({ params }: PageProps) {
  const { token } = await params;
  if (!token || token.length < 16) notFound();
  const lib = await prisma.dataLibrary.findUnique({
    where: { publicFillToken: token },
    select: {
      name: true,
      templateType: true,
      description: true,
      fieldsSchema: true,
    },
  });
  if (!lib) notFound();

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-8 sm:py-16">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
            Bibliothèque de données · {lib.templateType}
          </p>
          <h1 className="mt-2 text-[28px] sm:text-[36px] font-semibold tracking-tight text-foreground leading-[1.05]">
            {lib.name}
          </h1>
          {lib.description && (
            <p className="mt-2 text-[13px] text-muted-foreground max-w-md mx-auto">{lib.description}</p>
          )}
          <p className="mt-4 text-[13px] text-muted-foreground">
            Ajoute ci-dessous les fiches à intégrer dans cette bibliothèque. Tu peux en saisir plusieurs d&apos;un coup.
          </p>
        </div>

        <DataFillForm token={token} fieldsSchema={lib.fieldsSchema} />
      </div>
    </div>
  );
}
