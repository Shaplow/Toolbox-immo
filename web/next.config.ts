import type { NextConfig } from "next";

const CAPTIONS_API = process.env.CAPTIONS_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    // Augmente le plafond de body pour les uploads vidéo via /api/upload
    proxyClientMaxBodySize: 2 * 1024 * 1024 * 1024, // 2 GB
  },
  // Proxy direct pour les fichiers statiques du render-engine (images, vidéos).
  // Bypass le route handler JS (qui ne peut pas streamer efficacement les binaires).
  // "beforeFiles" prend priorité sur les routes filesystem, contrairement aux rewrites normaux.
  // Auth non requise ici : les URLs contiennent des noms de fichiers non-prévisibles.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/captions/outputs/:path*",
          destination: `${CAPTIONS_API}/outputs/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
