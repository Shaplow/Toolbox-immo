#!/bin/bash
# =============================================================================
# deploy.sh — Déploiement Toolbox Immo
#
# Usage : bash deploy.sh [--dry-run]
#
#   [1] Web       — Hetzner VPS (37.27.246.85)
#   [2] Docker    — RunPod (kodexfr/toolbox-render:vN)
#   [3] Les deux
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/render-engine/VERSION"
DOCKER_IMAGE="kodexfr/toolbox-render"
DOCKER_CACHE_IMAGE="${DOCKER_IMAGE}:buildcache"
SERVER_IP="37.27.246.85"
SERVER_USER="root"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Couleurs ──────────────────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

# ── Helpers ───────────────────────────────────────────────────────────────────
header() { echo -e "\n${BOLD}${BLUE}▶ $1${RESET}"; }
ok()     { echo -e "${GREEN}✔  $1${RESET}"; }
warn()   { echo -e "${YELLOW}⚠  $1${RESET}"; }
err()    { echo -e "${RED}✖  $1${RESET}"; exit 1; }
run()    {
  if $DRY_RUN; then
    echo -e "${YELLOW}[dry-run]${RESET} $*"
  else
    eval "$@"
  fi
}

# ── Déploiement web ───────────────────────────────────────────────────────────
deploy_web() {
  header "Déploiement Web → Hetzner (${SERVER_IP})"

  if ! command -v ssh &>/dev/null; then
    err "ssh introuvable"
  fi

  run "bash \"${SCRIPT_DIR}/web/scripts/deploy-remote.sh\" ${SERVER_IP} ${SERVER_USER}"
  WEB_DEPLOYED=true
}

# ── Déploiement Docker ────────────────────────────────────────────────────────
deploy_docker() {
  header "Déploiement Docker → RunPod"

  # Vérifications
  if ! command -v docker &>/dev/null; then
    err "docker introuvable"
  fi
  if ! docker buildx version &>/dev/null; then
    err "docker buildx introuvable"
  fi

  # Version
  if [[ ! -f "$VERSION_FILE" ]]; then
    echo "0" > "$VERSION_FILE"
  fi
  CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
  if ! [[ "$CURRENT_VERSION" =~ ^[0-9]+$ ]]; then
    err "VERSION invalide : '${CURRENT_VERSION}' (doit être un entier)"
  fi
  NEW_VERSION=$(( CURRENT_VERSION + 1 ))
  NEW_TAG="${DOCKER_IMAGE}:v${NEW_VERSION}"

  echo -e "   Version actuelle : ${YELLOW}v${CURRENT_VERSION}${RESET}"
  echo -e "   Nouveau tag      : ${BOLD}${NEW_TAG}${RESET}"

  # Build + push direct via Buildx
  # --push évite le gros export local (--load) puis un second upload via docker push.
  # Le cache registry réduit fortement les rebuilds quand seules quelques couches changent.
  header "Build + Push linux/amd64"
  run "docker buildx build \
    --platform linux/amd64 \
    -f \"${SCRIPT_DIR}/render-engine/Dockerfile.runpod\" \
    -t \"${NEW_TAG}\" \
    --cache-from type=registry,ref=\"${DOCKER_CACHE_IMAGE}\" \
    --cache-to type=registry,ref=\"${DOCKER_CACHE_IMAGE}\",mode=max \
    --provenance=false \
    --push \
    \"${SCRIPT_DIR}/render-engine\""

  # Écriture de la version (seulement si tout a réussi)
  if ! $DRY_RUN; then
    echo "$NEW_VERSION" > "$VERSION_FILE"
  fi

  DOCKER_DEPLOYED=true
  DOCKER_TAG="v${NEW_VERSION}"
  DOCKER_FULL_TAG="$NEW_TAG"
  ok "Image poussée : ${DOCKER_FULL_TAG}"
}

# ── Résumé final ──────────────────────────────────────────────────────────────
print_summary() {
  echo -e "\n${BOLD}════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  Résumé du déploiement${RESET}"
  echo -e "${BOLD}════════════════════════════════════════${RESET}"

  if ${WEB_DEPLOYED:-false}; then
    echo -e ""
    echo -e "${GREEN}${BOLD}Web (Hetzner)${RESET}"
    echo -e "  Serveur  : ${SERVER_USER}@${SERVER_IP}"
    echo -e "  Statut   : ${GREEN}déployé${RESET}"
  fi

  if ${DOCKER_DEPLOYED:-false}; then
    echo -e ""
    echo -e "${GREEN}${BOLD}Docker (RunPod)${RESET}"
    echo -e "  Image    : ${BOLD}${DOCKER_FULL_TAG}${RESET}"
    echo -e "  Statut   : ${GREEN}poussée${RESET}"
    echo -e ""
    echo -e "${YELLOW}${BOLD}→ Pense à mettre à jour l'endpoint RunPod :${RESET}"
    echo -e "   runpod.io → Serverless → ton endpoint"
    echo -e "   Container image : ${BOLD}${DOCKER_FULL_TAG}${RESET}"
  fi

  echo -e ""
}

# ── Menu ──────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo -e "╔══════════════════════════════════════╗"
echo -e "║     Toolbox Immo — Déploiement       ║"
echo -e "╚══════════════════════════════════════╝${RESET}"
$DRY_RUN && warn "Mode dry-run activé — aucune commande réelle ne sera exécutée\n"

echo -e "  ${BOLD}[1]${RESET} Web       — Hetzner VPS (${SERVER_IP})"
echo -e "  ${BOLD}[2]${RESET} Docker    — RunPod (${DOCKER_IMAGE})"
echo -e "  ${BOLD}[3]${RESET} Les deux"
echo ""
read -rp "Choix [1/2/3] : " CHOICE

case "$CHOICE" in
  1)
    deploy_web
    print_summary
    ;;
  2)
    deploy_docker
    print_summary
    ;;
  3)
    deploy_docker
    deploy_web
    print_summary
    ;;
  *)
    err "Choix invalide : '${CHOICE}'"
    ;;
esac
