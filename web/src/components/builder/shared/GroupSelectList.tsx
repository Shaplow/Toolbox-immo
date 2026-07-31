"use client";

/**
 * GroupSelectList — sélection des groupes overlay, hiérarchisée.
 *
 * Sémantique alignée sur le rendu (`expandGroupIdsWithChildren`) : cocher un
 * groupe parent INCLUT ses sous-groupes. Leurs cases passent donc cochées +
 * désactivées avec la mention « inclus ». Un sous-groupe reste cochable seul
 * tant que son parent ne l'est pas ; dans ce cas le parent affiche l'état
 * indéterminé.
 *
 * Sans cette hiérarchie, un sous-groupe créé après la configuration d'un clip
 * ou d'une cover ressemble à un groupe indépendant non coché — c'est ce qui a
 * fait disparaître des blocs du rendu final alors qu'ils s'affichaient dans le
 * builder.
 */

import { Checkbox } from "@/components/ui/Checkbox";
import { buildGroupTree, type GroupNode } from "@/lib/groupLayout";

type GroupOption = GroupNode & { name?: string };

interface Props {
  groups: readonly GroupOption[];
  /** IDs explicitement cochés (valeur stockée, sans expansion). */
  selectedIds: readonly string[];
  onToggle: (groupId: string, checked: boolean) => void;
  emptyLabel?: string;
}

function groupLabel(group: GroupOption): string {
  return group.name || group.id.slice(-6);
}

export function GroupSelectList({ groups, selectedIds, onToggle, emptyLabel }: Props) {
  const tree = buildGroupTree(groups);
  const selected = new Set(selectedIds);

  if (tree.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {emptyLabel ?? "Aucun groupe dans le template."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {tree.map(({ group, children }) => {
        const parentChecked = selected.has(group.id);
        const someChildChecked = children.some((child) => selected.has(child.id));
        return (
          <div key={group.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Checkbox
                size="sm"
                label={groupLabel(group)}
                checked={parentChecked ? true : someChildChecked ? "indeterminate" : false}
                onChange={(checked) => onToggle(group.id, checked)}
              />
              <span className="text-[11px] text-foreground truncate">{groupLabel(group)}</span>
            </div>
            {children.map((child) => (
              <div key={child.id} className="ml-3 flex items-center gap-2">
                <Checkbox
                  size="sm"
                  label={groupLabel(child)}
                  checked={parentChecked || selected.has(child.id)}
                  disabled={parentChecked}
                  onChange={(checked) => onToggle(child.id, checked)}
                />
                <span className="text-[10px] text-indigo-500" title="Sous-groupe">⊟</span>
                <span className="text-[11px] text-muted-foreground truncate">{groupLabel(child)}</span>
                {parentChecked && (
                  <span className="text-[10px] text-muted-foreground shrink-0">inclus</span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
