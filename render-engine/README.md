# render-engine

Microservice Python (FastAPI + FFmpeg) pour le rendu de sous-titres et le composite vidéo.

Deux modes :
- **Local** — tourne via `docker compose` ou directement avec uvicorn, utilisé quand `USE_RUNPOD=false`
- **RunPod** — image CUDA déployée en serverless, utilisé quand `USE_RUNPOD=true`

Le composite `template video` passe par un builder FFmpeg partagé entre les deux modes. Le cadrage du bloc vidéo, le comportement `cover/contain`, le mapping audio et l'arrêt en fin de source restent ainsi alignés entre local et RunPod.

---

## Fichiers clés

| Fichier | Rôle |
|---|---|
| `api.py` | FastAPI — endpoints locaux (`/api/render`, `/api/preview`, etc.) |
| `app.py` | Moteur de rendu + UI Gradio (dev) |
| `runpod_worker.py` | Worker RunPod serverless (jobs `captions` + `render_template`) |
| `engine/template_composite.py` | Builder FFmpeg partagé pour le composite template vidéo |
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

docker buildx build --platform linux/amd64 -f Dockerfile.runpod -t kodexfr/toolbox-render:latest --load .
docker push kodexfr/toolbox-render:latest
```

Sur Mac Apple Silicon, il faut builder l'image RunPod en `linux/amd64` via la commande `docker buildx build --platform linux/amd64 ...`. On ne fige pas la plateforme dans le `Dockerfile`, pour éviter les warnings de lint du type `FromPlatformFlagConstDisallowed`.

> Les polices du dossier `fonts/` sont copiées dans l'image. Vérifier qu'elles sont bien présentes avant de builder.

### 2. Créer l'endpoint sur RunPod

1. [runpod.io](https://runpod.io) → **Serverless** → **+ New Endpoint**
2. Container image : `kodexfr/toolbox-render:latest`
3. GPU : **RTX 4000 Ada** ou **RTX 3090** (~$0.22-0.24/h)
4. Scaling :
   - Min workers : **0** (pas de coût à l'idle)
   - Max workers : **4** — l'endpoint est partagé entre renders, captions,
     transcriptions et extraction de covers. À 2, une rafale de covers retarde les
     générations vidéo. Min workers restant à 0 et la facturation étant à la seconde
     d'exécution, relever ce plafond ne coûte rien à l'idle : ça n'augmente que le débit.
   - Execution timeout : **900s** — un job `cover_frames` télécharge un rush 4K puis
     en extrait jusqu'à 72 frames. À 300 s, RunPod tue le job et le pack part en échec
     sans aucune frame.
5. **FlashBoot** : activé (cold start ~40s → ~5s)
6. Variables d'environnement à renseigner dans l'onglet dédié :
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=toolbox-immo
   R2_PUBLIC_URL=https://pub-xxx.r2.dev
   ```

   Optionnel, extraction des frames de cover (mêmes valeurs qu'en local, cf.
   `docker-compose.yml`) :
   ```
   COVER_FRAME_MAX_EDGE=1920        # les covers sont composées en 1080×1920
   COVER_EXTRACT_CONCURRENCY=4      # ffmpeg simultanés par job
   COVER_EXTRACT_FRAME_TIMEOUT=120  # secondes par frame
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
