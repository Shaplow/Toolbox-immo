/**
 * RunPod Pod REST API wrappers (rest.runpod.io/v1/pods)
 *
 * Ces fonctions gèrent le cycle de vie d'un Pod On-Demand RunPod :
 * start, stop et lecture de statut.
 *
 * API ref: https://docs.runpod.io/api-reference/pods
 */

const RUNPOD_REST_BASE = "https://rest.runpod.io/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PodDesiredStatus = "RUNNING" | "EXITED" | "TERMINATED";

export interface RunpodPodInfo {
  id: string;
  desiredStatus: PodDesiredStatus;
  /** Public IP assigned to the pod once running (null while starting). */
  publicIp: string | null;
  /**
   * Port mappings once the pod is running.
   * e.g. { "8080": 12345 } means internal 8080 is accessible on port 12345.
   */
  portMappings: Record<string, number>;
  lastStartedAt: string | null;
  /**
   * Present once the container is actually running (after image pull + init).
   * null during image pull or while the container is still initializing.
   * Use this to distinguish "pulling image" from "container up but app not ready".
   */
  runtime: { uptimeInSeconds: number } | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Start (or resume) a stopped RunPod pod.
 * POST https://rest.runpod.io/v1/pods/{podId}/start
 */
export async function startRunpodPod(podId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${RUNPOD_REST_BASE}/pods/${podId}/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`RunPod start pod ${res.status}: ${await res.text()}`);
  }
}

/**
 * Stop a running RunPod pod (releases GPU, keeps volume disk).
 * POST https://rest.runpod.io/v1/pods/{podId}/stop
 */
export async function stopRunpodPod(podId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${RUNPOD_REST_BASE}/pods/${podId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`RunPod stop pod ${res.status}: ${await res.text()}`);
  }
}

/**
 * Fetch current pod metadata (status, IP, port mappings).
 * GET https://rest.runpod.io/v1/pods?id={podId}
 */
export async function getRunpodPodInfo(podId: string, apiKey: string): Promise<RunpodPodInfo> {
  const url = `${RUNPOD_REST_BASE}/pods?id=${encodeURIComponent(podId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`RunPod get pod ${res.status}: ${await res.text()}`);
  }
  const pods = await res.json() as RunpodPodInfo[];
  const pod = pods.find((p) => p.id === podId);
  if (!pod) {
    throw new Error(`RunPod pod ${podId} not found`);
  }
  return pod;
}

/**
 * Build the base URL for the pod's FastAPI server from its portMappings.
 *
 * RunPod exposes pods via a proxy: https://{podId}-{internalPort}.proxy.runpod.net
 * This is available once desiredStatus=RUNNING and portMappings is populated.
 *
 * @param podId           The RunPod pod ID.
 * @param internalPort    The internal port exposed in the pod config (default 8080).
 */
export function buildPodFastapiUrl(podId: string, internalPort = 8080): string {
  return `https://${podId}-${internalPort}.proxy.runpod.net`;
}

// ─── GPU type preferences ─────────────────────────────────────────────────────

/**
 * GPU types in priority order for Whisper ML inference + NVENC video rendering.
 *
 * Ordered by best price/availability for this workload.
 * Excludes RTX 3090 / RTX 4090 / RTX 5090 — known CUDA compatibility issues.
 *
 * Names must match RunPod API exactly (gpuTypeIds field in POST /pods).
 * RunPod will try each in order and pick the first one available.
 * Consumer cards (GeForce) are listed last — cheaper but less stable drivers.
 */
export const PREFERRED_GPU_TYPES: string[] = [
  "NVIDIA GeForce RTX 3080",        // ~$0.20-0.28/hr consumer, CUDA OK
  "NVIDIA RTX 2000 Ada Generation", // ~$0.22-0.30/hr 16 GB Ada
  "NVIDIA RTX A4000",               // ~$0.24-0.34/hr 16 GB pro
  "NVIDIA GeForce RTX 4080",        // ~$0.35-0.44/hr consumer, CUDA OK
  "NVIDIA RTX A4500",               // ~$0.34-0.44/hr 20 GB pro
  "NVIDIA RTX 4000 Ada Generation", // ~$0.35-0.45/hr 20 GB Ada
  "NVIDIA RTX A5000",               // ~$0.40-0.50/hr 24 GB pro
  "NVIDIA A40",                     // ~$0.40-0.54/hr 48 GB datacenter
  "NVIDIA L4",                      // ~$0.45-0.59/hr 24 GB datacenter
  "NVIDIA RTX A6000",               // ~$0.55-0.79/hr 48 GB pro
  "NVIDIA RTX 6000 Ada Generation", // ~$0.70-0.90/hr 48 GB Ada pro
  "NVIDIA L40S",                    // ~$0.70-0.99/hr 48 GB datacenter
];

// ─── Pod lifecycle — create / terminate ──────────────────────────────────────

/**
 * Create a new pod from a RunPod template.
 *
 * The pod starts immediately (desiredStatus=RUNNING in the response).
 * Call waitForFastapiReady() after this to ensure the container is up.
 *
 * @param templateId       RUNPOD_POD_TEMPLATE_ID
 * @param networkVolumeId  RUNPOD_NETWORK_VOLUME_ID (null = no persistent volume)
 * @param gpuTypeIds       Ordered GPU preference list (see PREFERRED_GPU_TYPES)
 * @param apiKey           RUNPOD_API_KEY
 * @returns                The new pod ID
 */
export async function createRunpodPod(
  templateId: string,
  networkVolumeId: string | null,
  gpuTypeIds: string[],
  apiKey: string
): Promise<string> {
  const body: Record<string, unknown> = {
    templateId,
    name: "toolbox-render",
    // COMMUNITY = machines partagées, ~2-3x plus de dispo, ~30% moins cher.
    // Secure = datacenter dédié, moins de dispo mais meilleur uptime garanti.
    // Pour ce workload (Whisper + FFmpeg, données via R2), community est suffisant.
    cloudType: "COMMUNITY",
    gpuTypeIds,
    gpuTypePriority: "availability",
    gpuCount: 1,
    ports: ["8080/http", "22/tcp"],
    // 30 Go et non 20 : l'image (CUDA + torch + whisperx + pyannote + modèles
    // pré-bakés) en consomme l'essentiel, et /tmp vit sur ce même disque. À 20 Go
    // il ne restait que quelques Go utiles — d'où les [Errno 28] No space left on
    // device observés en transcription. L'extraction audio en streaming
    // (engine/audio_source.py) évite désormais d'y poser la vidéo, mais cette
    // marge supprime toute une classe d'échecs pour quelques centimes/mois.
    // Ne PAS dimensionner ce disque pour la taille des rushs : sur cloudType
    // COMMUNITY, un gros container disk réduit fortement la dispo des offres GPU.
    containerDiskInGb: 30,
    volumeMountPath: "/workspace",
  };
  if (networkVolumeId) {
    body.networkVolumeId = networkVolumeId;
  }

  const res = await fetch(`${RUNPOD_REST_BASE}/pods`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`RunPod create pod ${res.status}: ${await res.text()}`);
  }

  const pod = await res.json() as { id: string };
  if (!pod.id) {
    throw new Error("RunPod create pod: no id in response");
  }
  return pod.id;
}

/**
 * Permanently terminate (delete) a RunPod pod.
 * Use to clean up orphaned pods when the GPU is no longer available.
 * Non-blocking in callers — errors are just logged.
 */
export async function terminateRunpodPod(podId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${RUNPOD_REST_BASE}/pods/${podId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`RunPod terminate pod ${res.status}: ${await res.text()}`);
  }
}
