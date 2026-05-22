---
description: Lance un audit de sécurité papier sur une surface spécifique.
argument-hint: [surface à auditer + fichiers concernés]
---

Lance l'agent `security-auditor` via le Task tool avec ce briefing pour faire un audit de sécurité papier.

Couvre au minimum :
- Validation de l'authentification et des permissions
- Inputs non validés ou non échappés (XSS, injection, path traversal)
- Isolation des données entre comptes (multi-tenant)
- Secrets potentiellement exposés (logs, réponses API)
- Uploads ou URLs non contrôlés (SSRF, file type bypass)
- Webhooks RunPod (validation signature, IP allowlist)

**Surface à auditer :**

$ARGUMENTS
