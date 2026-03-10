# render-engine

Microservice Python (FastAPI + FFmpeg) pour le rendu de sous-titres et le composite vidéo.

Deux modes :
- **Local** — tourne via `docker compose` ou directement avec uvicorn, utilisé quand `USE_RUNPOD=false`
- **RunPod** — image CUDA déployée en serverless, utilisé quand `USE_RUNPOD=true`

---

## Fichiers clés

| Fichier | Rôle |
|---|---|
| `api.py` | FastAPI — endpoints locaux (`/api/render`, `/api/preview`, etc.) |
| `app.py` | Moteur de rendu + UI Gradio (dev) |
| `runpod_worker.py` | Worker RunPod serverless (jobs `captions` + `render_template`) |
| `Dockerfile` | Image dev/local — utilisée par `docker compose` |
| `Dockerfile.runpod` | Image prod RunPod — base CUDA, sans Gradio |
| `requirements.txt` | Dépendances locales (inclut Gradio) |
| `requirements-worker.txt` | Dépendances RunPod uniquement (pas de Gradio) |

---

## Lancer en local

```bash
# Depuis la racine du projet
docker compose up render-engine

# Ou directement
cd render-engine
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

---

## Déployer sur RunPod Serverless

### 1. Builder et pusher l'image

```bash
cd render-engine

docker build -f Dockerfile.runpod -t kodexfr/toolbox-render:latest .
docker push kodexfr/toolbox-render:latest
```

> Les polices du dossier `fonts/` sont copiées dans l'image. Vérifier qu'elles sont bien présentes avant de builder.

### 2. Créer l'endpoint sur RunPod

1. [runpod.io](https://runpod.io) → **Serverless** → **+ New Endpoint**
2. Container image : `kodexfr/toolbox-render:latest`
3. GPU : **RTX 4000 Ada** ou **RTX 3090** (~$0.22-0.24/h)
4. Scaling :
   - Min workers : **0** (pas de coût à l'idle)
   - Max workers : **2**
   - Execution timeout : **300s**
5. **FlashBoot** : activé (cold start ~40s → ~5s)
6. Variables d'environnement à renseigner dans l'onglet dédié :
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=toolbox-immo
   R2_PUBLIC_URL=https://pub-xxx.r2.dev
   ```

### 3. Configurer l'app

Dans `/.env` (racine du projet) :

```env
USE_RUNPOD=true
RUNPOD_API_KEY=rp_xxxxxxxxxxxx
RUNPOD_ENDPOINT_ID=<endpoint-id>

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=toolbox-immo
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

---

## Variables d'env RunPod (résumé)

| Variable | Où |
|---|---|
| `RUNPOD_API_KEY` | Profil RunPod → API Keys |
| `RUNPOD_ENDPOINT_ID` | Page de l'endpoint créé |
| `R2_*` | Cloudflare R2 → bucket → API tokens |

## Dossiers

- `engine/` : logique probe/layout/ASS/render
- `fonts/` : polices `.ttf` (optionnel mais recommandé)
- `outputs/` : vidéos rendues + fichiers `.ass`
