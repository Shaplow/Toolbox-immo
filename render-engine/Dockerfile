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

# Torch CPU-only d'abord : évite de télécharger les wheels CUDA (~2.5 GB) inutiles en dev local
RUN pip install --no-cache-dir torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

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

# Dev : --reload pour hot-reload sur changements de code
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
