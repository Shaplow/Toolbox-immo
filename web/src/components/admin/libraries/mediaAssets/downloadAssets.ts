"use client";

/**
 * Téléchargement d'assets de la médiathèque.
 *
 * Deux chemins, selon le nombre de fichiers :
 *  - unitaire  → `GET  media/assets/[assetId]`          (1 URL pré-signée)
 *  - en lot    → `POST media/assets/download-urls`      (N URLs en 1 requête)
 *
 * Dans les deux cas le binaire va de R2 au navigateur sans passer par le
 * serveur. Le déclenchement lui-même (iframes échelonnés) vit dans
 * `lib/triggerDownloads.ts`, partagé avec les rushs de publication.
 *
 * Accessible à tous les rôles médiathèque, MONTEUR compris : c'est la seule
 * action que ce dernier peut effectuer ici.
 */

import { toast } from "@/components/ui/Toast";
import { triggerDownload, triggerDownloads } from "@/lib/triggerDownloads";

/** Doit rester aligné sur `MAX_ASSETS_PER_BATCH` côté route. */
export const MAX_DOWNLOAD_BATCH = 25;

export type DownloadableAsset = { id: string; filename: string };

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Erreur ${res.status}`;
}

/** Télécharge un fichier unique. Gère son propre toast d'erreur. */
export async function downloadAsset(asset: DownloadableAsset): Promise<void> {
  try {
    const res = await fetch(`/api/admin/libraries/media/assets/${asset.id}`);
    if (!res.ok) throw new Error(await readError(res));
    const { downloadUrl } = (await res.json()) as { downloadUrl: string };
    triggerDownload(downloadUrl, asset.filename);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Erreur lors du téléchargement");
  }
}

/**
 * Télécharge un lot de fichiers (groupe ou sélection multiple).
 *
 * Un seul fichier retombe sur le chemin unitaire — inutile de payer un POST et
 * de passer par un iframe pour un seul transfert.
 */
export async function downloadAssets(assets: DownloadableAsset[]): Promise<void> {
  if (assets.length === 0) return;
  if (assets.length === 1) return downloadAsset(assets[0]!);

  if (assets.length > MAX_DOWNLOAD_BATCH) {
    toast.info(
      `Maximum ${MAX_DOWNLOAD_BATCH} fichiers à la fois — ta sélection en compte ${assets.length}.`,
    );
    return;
  }

  try {
    const res = await fetch("/api/admin/libraries/media/assets/download-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: assets.map((a) => a.id) }),
    });
    if (!res.ok) throw new Error(await readError(res));

    const { assets: signed } = (await res.json()) as {
      assets: { id: string; filename: string; url: string }[];
    };

    triggerDownloads(signed.map((a) => a.url));
    toast.success(
      `${signed.length} téléchargement${signed.length > 1 ? "s" : ""} lancé${signed.length > 1 ? "s" : ""}`,
    );
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Erreur lors du téléchargement");
  }
}
