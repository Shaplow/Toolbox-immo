"""
Pod Server — Point d'entrée FastAPI pour le mode Pod On-Demand RunPod.

Expose toutes les routes de api.py PLUS /api/run qui émule l'interface
RunPod Serverless : reçoit { input: {...}, webhook: "..." }, traite le job
en background et appelle le webhook avec le résultat.

Usage (CMD du pod RunPod) :
    uvicorn pod_server:app --host 0.0.0.0 --port 8080

Variables d'environnement requises : identiques au worker RunPod
(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL)
"""

from __future__ import annotations

import os as _os
import threading
import time
import uuid
from typing import Any

# ─── HF_HOME fallback ─────────────────────────────────────────────────────────
# Must run BEFORE any whisper/torch import to take effect.
#
# The RunPod template sets HF_HOME=/workspace/models so models are persisted
# on the network volume. But when the pod is created without a volume (fallback),
# /workspace/models is empty and Python re-downloads 2-3 GB of models → 5 min
# cold start.
#
# Fix: if HF_HOME points to an empty/missing hub dir, use the models baked into
# the image at /app/hf_cache (downloaded during `docker build`).
def _fix_hf_home() -> None:
    hf_home = _os.environ.get("HF_HOME", "")
    if not hf_home:
        return
    hub_dir = _os.path.join(hf_home, "hub")
    baked = "/app/hf_cache"
    if not _os.path.isdir(hub_dir) or not any(_os.scandir(hub_dir)):
        if _os.path.isdir(baked):
            print(f"[pod_server] HF_HOME={hf_home} vide → fallback modèles baked {baked}", flush=True)
            _os.environ["HF_HOME"] = baked
        else:
            print(f"[pod_server] HF_HOME={hf_home} vide et {baked} absent → téléchargement au runtime", flush=True)

_fix_hf_home()

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse

# Importer l'app FastAPI existante (toutes ses routes sont incluses)
from api import app  # noqa: F401  — side-effect: registers all existing routes

# Importer le handler principal du worker (dispatch par job_type)
# runpod_worker importe depuis api/app, donc pas de circularité ici.
from runpod_worker import handler as _worker_handler


# ─── Concurrency guard ────────────────────────────────────────────────────────
# The pod has a single GPU. Only one job should run at a time to avoid CUDA OOM.
# A non-blocking acquire returns 503 immediately when the pod is busy so the web
# layer (submitRunpodJob) can fall back to Serverless instead of queuing blindly.
_job_semaphore = threading.Semaphore(1)


# ─── /health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> JSONResponse:
    """Health check endpoint used by podOrchestrator.ts to detect readiness."""
    return JSONResponse({"status": "ok"})


# ─── /api/run ─────────────────────────────────────────────────────────────────

@app.post("/api/run")
async def run_job(request: Request) -> JSONResponse:
    """
    Émule l'interface RunPod Serverless pour les pods On-Demand.

    Payload attendu (identique au Serverless RunPod) :
      {
        "input": { "job_type": "captions"|"transcribe"|..., ...params },
        "webhook": "https://your-app/api/webhooks/runpod/captions"  // optionnel
      }

    Réponse immédiate (200) :
      { "id": "pod-<hex>" }

    Réponse si pod déjà occupé (503) :
      { "error": "Pod busy" }
      → le web layer tombe en fallback Serverless automatiquement.

    Le job est traité en background thread. Quand terminé, le webhook
    est appelé avec retry automatique :
      { "id": "pod-<hex>", "status": "COMPLETED"|"FAILED", "output": {...} }
    """
    body = await request.json()
    inp: dict[str, Any] = body.get("input", {})
    webhook_url: str | None = body.get("webhook")
    job_id = f"pod-{uuid.uuid4().hex[:12]}"

    # Non-blocking: reject immediately if GPU is already busy.
    if not _job_semaphore.acquire(blocking=False):
        print(f"[pod_server] Pod occupé — refus du job {job_id} (503)", flush=True)
        return JSONResponse({"error": "Pod busy"}, status_code=503)

    def _run() -> None:
        try:
            output = _worker_handler({"input": inp})
            payload: dict[str, Any] = {
                "id": job_id,
                "status": "COMPLETED",
                "output": output,
            }
        except Exception as exc:
            print(f"[pod_server] Job {job_id} failed: {exc}", flush=True)
            payload = {
                "id": job_id,
                "status": "FAILED",
                "error": str(exc),
            }
        finally:
            # Release GPU slot as soon as processing finishes — webhook is network I/O only.
            _job_semaphore.release()

        if webhook_url:
            _send_webhook_with_retry(job_id, webhook_url, payload)
        else:
            print(f"[pod_server] Job {job_id} terminé sans webhook configuré", flush=True)

    # daemon=False: Python waits for this thread on SIGTERM/shutdown, giving the
    # running job a chance to finish and call its webhook before the process exits.
    threading.Thread(target=_run, daemon=False).start()
    print(f"[pod_server] Job {job_id} démarré (job_type={inp.get('job_type', 'unknown')})", flush=True)
    return JSONResponse({"id": job_id})


# ─── Webhook delivery with retry ──────────────────────────────────────────────

# Delays between retry attempts (seconds). Total budget: 5 + 15 + 30 = 50s of retries.
_WEBHOOK_RETRY_DELAYS_S = [5, 15, 30]


def _send_webhook_with_retry(job_id: str, url: str, payload: dict[str, Any]) -> None:
    """POST the webhook with up to 3 retries on network/timeout failure."""
    max_attempts = len(_WEBHOOK_RETRY_DELAYS_S) + 1
    for attempt in range(1, max_attempts + 1):
        if attempt > 1:
            delay = _WEBHOOK_RETRY_DELAYS_S[attempt - 2]
            print(
                f"[pod_server] Webhook retry {attempt}/{max_attempts} dans {delay}s "
                f"— job {job_id}",
                flush=True,
            )
            time.sleep(delay)
        try:
            response = httpx.post(url, json=payload, timeout=30)
            # Treat HTTP errors (4xx, 5xx) as failures so they are retried.
            # Without this, a 401/500 from the web app silently succeeds here
            # and onPodJobComplete() is never called → pod stuck running forever.
            response.raise_for_status()
            print(
                f"[pod_server] Webhook appelé ✓ (attempt {attempt}, {url}, "
                f"status={response.status_code})",
                flush=True,
            )
            return
        except Exception as exc:
            print(
                f"[pod_server] Webhook échoué attempt {attempt}/{max_attempts} "
                f"({url}): {exc}",
                flush=True,
            )

    print(
        f"[pod_server] Webhook abandonné après {max_attempts} tentatives — job {job_id} perdu",
        flush=True,
    )
