---
mode: agent
agent: security-auditor
description: Lance un audit de sécurité papier sur une surface spécifique. Décris la surface à auditer après ce prompt.
---

Fais un audit de sécurité papier sur la surface suivante.

**Surface à auditer :**

[DÉCRIS CE QUI VIENT D'ÊTRE AJOUTÉ OU MODIFIÉ — ex: "nouvelle route upload de fichiers", "flow d'impersonation admin", "endpoint RunPod webhook"]

**Fichiers concernés :**

[LISTE LES FICHIERS]

**Points d'attention spécifiques (optionnel) :**

[EX: "cette route est publique", "elle accepte des URLs fournies par l'utilisateur", "elle touche des données multi-compte"]

Couvre au minimum :
- Validation de l'authentification et des permissions
- Inputs non validés ou non échappés
- Isolation des données entre comptes
- Secrets potentiellement exposés
- Uploads ou URLs non controlés
