# Dockerfile — render-engine (dev local / docker compose)
# Usage : docker compose up render-engine

FROM python:3.11-slim

# Dépendances système (FFmpeg + libass pour le rendu sous-titres)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libass9 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code source
COPY . .

# Dossier outputs persistant
RUN mkdir -p outputs/temp/api

ENV PYTHONUNBUFFERED=1

# Expose port FastAPI
EXPOSE 8000

# Dev : --reload pour hot-reload sur changements de code
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
