---
description: Triage rapide — décris ta demande et obtiens une stratégie (quel agent, quel ordre).
argument-hint: [description de la tâche]
---

Analyse la demande ci-dessous et réponds en 3-4 lignes :
1. Par quel agent commencer et pourquoi (`feature-planner`, `toolbox-generalist`, `bug-hunter`, `code-reviewer`, `security-auditor`, `ux-auditor`, `skill-manager`)
2. Si un plan est nécessaire avant d'implémenter
3. Quels prompts utiliser dans quel ordre

Pour invoquer un agent en Claude Code, utilise le Task tool avec `subagent_type: "<nom-d-agent>"`.

Ne commence pas à implémenter. Réponds seulement avec la stratégie recommandée.

**Demande :**

$ARGUMENTS
