# ⚠️ Obsolescence des cartographies (plan simplification, août 2026)

Les maps de ce dossier ont été générées avant le plan de simplification
(phases D1→C, 16-17/08/2026). Sont notamment PÉRIMÉES :
- `asset-rotation-engine.md`, `admin-rotation-cursor-reset.md` — le moteur de
  rotation (curseurs/catégories/override) est décommissionné, remplacé par le
  tirage « dossier simple » (voir skill `asset-rotation`).
- `account-pattern-config.md`, `calendar-generate-week.md` — AccountPattern
  décommissionné (PatternTemplate+PatternBinding canoniques).
- Toute map référençant Property/ShootEvent — fusionnés dans Entity/EntityType
  (« Fiches », `/fiches`).

Re-générer via `/map-workflow` avant de s'en servir comme référence.
