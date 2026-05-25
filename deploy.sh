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
# Cache local sur la machine de build (évite les 400 Docker Hub sur mode=max volumineux).
# Le cache persiste entre les builds tant que ~/.cache/toolbox-render-buildcache/ existe.
# Supprimer ce dossier pour forcer un full rebuild propre.
DOCKER_LOCAL_CACHE="${HOME}/.cache/toolbox-render-buildcache"
SERVER_IP="37.27.246.85"
SERVER_USER="root"

# La prod est toujours déployée depuis cette ref git (par défaut origin/main), pas depuis
# les fichiers locaux du working tree. Permet de travailler sur n'importe quelle branche
# de feature sans qu'elle ne pollue le déploiement. Override possible via env var :
#   DEPLOY_REF=HEAD bash deploy.sh        # déploie la branche courante
#   DEPLOY_REF=feat/foo bash deploy.sh    # déploie une autre branche
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
DEPLOY_SOURCE_DIR="${HOME}/.cache/toolbox-deploy-source"

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

# ── Préparation source depuis git ─────────────────────────────────────────────
# Crée un worktree git temporaire pointant sur DEPLOY_REF (origin/main par défaut)
# et y symlinke les fichiers gitignorés requis (.env.prod). Le déploiement utilisera
# ce répertoire comme source au lieu du working tree de l'utilisateur, ce qui rend
# le déploiement indépendant de la branche courante / des modifs non commitées.
prepare_deploy_source() {
  header "Préparation source — ${DEPLOY_REF}"

  if ! git -C "${SCRIPT_DIR}" rev-parse --git-dir >/dev/null 2>&1; then
    err "${SCRIPT_DIR} n'est pas un dépôt git — impossible de préparer le worktree de deploy"
  fi

  # Récupère les derniers commits avant de checkout
  run "git -C \"${SCRIPT_DIR}\" fetch origin main --quiet"

  # Nettoie un worktree résiduel d'un deploy précédent (si interrompu)
  if [[ -d "${DEPLOY_SOURCE_DIR}" ]]; then
    git -C "${SCRIPT_DIR}" worktree remove --force "${DEPLOY_SOURCE_DIR}" 2>/dev/null || true
    rm -rf "${DEPLOY_SOURCE_DIR}"
  fi

  run "git -C \"${SCRIPT_DIR}\" worktree add --detach \"${DEPLOY_SOURCE_DIR}\" \"${DEPLOY_REF}\""

  if ! $DRY_RUN; then
    # .env.prod n'est jamais commité → vient du working tree user
    if [[ -f "${SCRIPT_DIR}/.env.prod" ]]; then
      ln -sf "${SCRIPT_DIR}/.env.prod" "${DEPLOY_SOURCE_DIR}/.env.prod"
    fi

    local deployed_sha deployed_msg
    deployed_sha=$(git -C "${DEPLOY_SOURCE_DIR}" rev-parse --short HEAD 2>/dev/null || echo "?")
    deployed_msg=$(git -C "${DEPLOY_SOURCE_DIR}" log -1 --pretty=%s 2>/dev/null || echo "?")
    ok "Commit à déployer : ${BOLD}${deployed_sha}${RESET}${GREEN} — ${deployed_msg}"
  fi
}

cleanup_deploy_source() {
  if [[ -d "${DEPLOY_SOURCE_DIR}" ]]; then
    git -C "${SCRIPT_DIR}" worktree remove --force "${DEPLOY_SOURCE_DIR}" 2>/dev/null || true
    rm -rf "${DEPLOY_SOURCE_DIR}"
  fi
}

trap cleanup_deploy_source EXIT

# ── Déploiement web ───────────────────────────────────────────────────────────
deploy_web() {
  header "Déploiement Web → Hetzner (${SERVER_IP})"

  if ! command -v ssh &>/dev/null; then
    err "ssh introuvable"
  fi

  run "bash \"${DEPLOY_SOURCE_DIR}/web/scripts/deploy-remote.sh\" ${SERVER_IP} ${SERVER_USER}"
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
  # Cache local (type=local,mode=max) : stocke tous les layers intermédiaires sur le Mac.
  # Beaucoup plus fiable que le cache registry (Docker Hub rejette les blobs mode=max >2 GB).
  # Sur un simple changement de code (.py), seul le dernier COPY . . est reconstruit.
  # On pousse AUSSI :latest pour que les pods créés depuis la template RunPod
  # tirent toujours la dernière image sans avoir à mettre à jour la template manuellement.
  header "Build + Push linux/amd64"
  mkdir -p "${DOCKER_LOCAL_CACHE}"
  run "docker buildx build \
    --platform linux/amd64 \
    -f \"${DEPLOY_SOURCE_DIR}/render-engine/Dockerfile.runpod\" \
    -t \"${NEW_TAG}\" \
    -t \"${DOCKER_IMAGE}:latest\" \
    --cache-from type=local,src=\"${DOCKER_LOCAL_CACHE}\" \
    --cache-to type=local,dest=\"${DOCKER_LOCAL_CACHE}\",mode=max \
    --provenance=false \
    --push \
    \"${DEPLOY_SOURCE_DIR}/render-engine\""

  # Écriture de la version (seulement si tout a réussi)
  if ! $DRY_RUN; then
    echo "$NEW_VERSION" > "$VERSION_FILE"
  fi

  DOCKER_DEPLOYED=true
  DOCKER_TAG="v${NEW_VERSION}"
  DOCKER_FULL_TAG="$NEW_TAG"
  ok "Image poussée : ${DOCKER_FULL_TAG} + :latest"
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
    echo -e "  Image    : ${BOLD}${DOCKER_FULL_TAG}${RESET} (+ :latest)"
    echo -e "  Statut   : ${GREEN}poussée${RESET}"
    echo -e ""
    echo -e "${YELLOW}${BOLD}→ Mettre à jour l'endpoint Serverless RunPod :${RESET}"
    echo -e "   runpod.io → Serverless → ton endpoint"
    echo -e "   Container image : ${BOLD}${DOCKER_FULL_TAG}${RESET}"
    echo -e ""
    echo -e "${GREEN}${BOLD}→ Template pod (kodexfr/toolbox-render:latest) : mise à jour automatique ✓${RESET}"
    echo -e "   Les prochains pods créés tireront automatiquement la nouvelle image."
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
    prepare_deploy_source
    deploy_web
    print_summary
    ;;
  2)
    prepare_deploy_source
    deploy_docker
    print_summary
    ;;
  3)
    prepare_deploy_source
    deploy_docker
    deploy_web
    print_summary
    ;;
  *)
    err "Choix invalide : '${CHOICE}'"
    ;;
esac
