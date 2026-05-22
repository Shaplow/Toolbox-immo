---
description: Lance une chasse aux bugs ciblée sur un module ou une feature.
argument-hint: [nom du module + fichiers clés]
---

Lance l'agent `bug-hunter` via le Task tool avec ce briefing pour chasser les bugs, edge cases et failures d'intégration.

**Priorités de recherche :**
- Bugs liés aux changements récents en premier
- Edge cases sur les états vides ou partiels (job à mi-chemin, liste vide, compte sans accès)
- Failures silencieuses (async sans await, catch qui retourne success)
- Isolation multi-compte (un compte peut-il accéder aux données d'un autre ?)
- Race conditions entre webhook callbacks et job updates

**Module / feature ciblé :**

$ARGUMENTS
