<!-- Merci de remplir ce template. Sections en commentaire HTML = à supprimer si non pertinent. -->

## Summary

<!-- 1–3 bullet points qui expliquent ce que fait cette PR (le "quoi" + le "pourquoi"). -->

-
-

## Phase / module touché

<!-- Coche ce qui s'applique. -->

- [ ] `web/` — Next.js, Prisma, UI, API routes
- [ ] `render-engine/` — FFmpeg, RunPod worker, FastAPI
- [ ] Builder / template normalization
- [ ] Publications pipeline (fiche, recipes, worklists, calendar)
- [ ] Admin / permissions / rôles (ADMIN/MONTEUR/CM/USER)
- [ ] Captions / transcription
- [ ] Cover / cover-frames
- [ ] Content library (MediaAsset, DataEntry, rotation)
- [ ] Description generation
- [ ] Infrastructure (deploy.sh, CI, scripts)
- [ ] Documentation / CLAUDE.md / instructions

## Breaking changes / migrations

<!-- Cocher SI applicable, sinon retirer la section. -->

- [ ] **Prisma migration** — nom : `<timestamp>_<name>` (vérifie que `npm run db:backup` est lancé avant `migrate deploy` prod)
- [ ] **URL changes** — anciennes URLs avec redirect ? Lesquelles ?
- [ ] **Permissions changes** — quel rôle perd/gagne quel accès ?
- [ ] **API contract changes** — payload/response modifié ?

## Test plan

<!-- Liste des tests manuels à faire en review. Au minimum : lint + build + 1 smoke test par feature. -->

- [ ] `cd web && npm run lint -- <fichiers touchés>`
- [ ] `cd web && npm run build` passe
- [ ] Smoke test (parcours utilisateur réel) :
  - [ ]
  - [ ]

## Sécurité / dette

<!-- Optionnel : lister findings audit (security-auditor / code-reviewer) résolus dans cette PR + dette nouvelle introduite. -->

-

## Screenshots / vidéos

<!-- Pour les changements UI : avant/après. -->

---

🤖 _Si cette PR a été produite avec Claude Code, merci de garder les `Co-Authored-By` dans les commits._
