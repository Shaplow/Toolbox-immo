import path from "path";

/**
 * Dossier des PNG de rendu. nginx les sert directement sous `/renders/`
 * (scripts/setup-nginx.sh) ; le rsync de déploiement l'exclut, il survit donc
 * aux deploys.
 */
export const RENDERS_DIR = path.join(process.cwd(), "public", "renders");
