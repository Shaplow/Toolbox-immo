# Dockerfile — render-engine (dev local / docker compose)
# Usage : docker compose up render-engine

FROM python:3.11-slim

# Dépendances système (FFmpeg + libass pour le rendu sous-titres + audio pour WhisperX)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    libass9 \
    libpango-1.0-0 \
    libsndfile1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pip 24.0 (version du slim) échoue avec "from versions: none" sur lightning>=2.0.1
# lorsqu'il résout un grand arbre de dépendances incluant whisperx+pyannote-audio.
# pip 26+ corrige ce bug. À faire AVANT l'install de torch.
RUN pip install --upgrade pip

# Torch CPU-only, version épinglée pour correspondre à ce que whisperx>=3.7.0 exige (torch~=2.8.0).
RUN pip install --no-cache-dir "torch==2.8.0" "torchaudio==2.8.0" \
    --index-url https://download.pytorch.org/whl/cpu

# Pre-install lightning en étape isolée.
# Toutes les versions de pyannote-audio (3.x ET 4.x) requièrent lightning>=2.0.1
# directement ou via pyannote.pipeline. Quand pip résout l'arbre complet en une seule
# passe, il ne trouve aucune version (bug pip 24). L'installer séparément en amont
# contourne le problème : pip voit le paquet déjà présent lors de la résolution principale.
RUN pip install --no-cache-dir "lightning>=2.0.1"

# Dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code source
COPY . .

# Dossier outputs persistant
RUN mkdir -p outputs/temp/api

ENV PYTHONUNBUFFERED=1
ENV CAPTIONS_ENGINE=ass

# Expose port FastAPI
EXPOSE 8000

# --reload (hot-reload dev) est opt-in via UVICORN_RELOAD=1, activé par
# docker-compose en local. Jamais en prod : le reloader surveille le disque et
# peut redémarrer le worker en plein rendu, ce qui tue les jobs en vol.
ENV UVICORN_RELOAD=0
CMD ["sh", "-c", "exec uvicorn api:app --host 0.0.0.0 --port 8000 $([ \"$UVICORN_RELOAD\" = \"1\" ] && echo --reload)"]
