---
mode: agent
agent: bug-hunter
description: Lance une chasse aux bugs ciblée sur un module ou une feature. Précise le module cible après ce prompt.
---

Chasse les bugs, edge cases et failures d'intégration dans le module suivant.

**Module cible :**

[NOM DU MODULE OU FEATURE — ex: "content library selection rules", "captions job pipeline", "derush export"]

**Fichiers principaux à analyser :**

[LISTE LES FICHIERS CLÉS SI CONNUS]

**Ce qui vient d'être modifié (si applicable) :**

[DÉCRIS LES CHANGEMENTS RÉCENTS — aide le bug-hunter à prioriser les zones nouvelles]

**Priorités de recherche :**
- Bugs liés aux changements récents en premier
- Edge cases sur les états vides ou partiels (job à mi-chemin, liste vide, compte sans accès)
- Failures silencieuses (async sans await, catch qui retourne success)
- Isolation multi-compte
