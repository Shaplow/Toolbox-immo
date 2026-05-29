"use client";

/**
 * AssigneePicker — sélecteur d'utilisateur avec rôle + avatar.
 *
 * Factorise AssigneeSelect + AssigneeInlineEdit (PublicationHeader,
 * SlotDetailPanel).
 *
 * Doctrine Liquid Glass v2 :
 * - Trigger : same look que Combobox (glass tinté sky).
 * - Popover : surface-glass-strong avec ring inset + shadow-glass-popover.
 * - Items custom : Avatar + nom + email gray + chip role à droite.
 * - Groupés par rôle (optionnel, default true).
 * - cmdk pour le fuzzy search (nom + email + role).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { Check, ChevronDown, Search, UserX } from "lucide-react";
import { Avatar } from "../Avatar";
import { Chip } from "../Chip";

type UserRole = "ADMIN" | "VIDEASTE" | "MONTEUR" | "CM" | "EXTERNAL_GENERATOR" | "USER" | string;

interface AssigneeUser {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  avatar?: string;
}

interface AssigneePickerProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  users: AssigneeUser[];
  /** Group items by role. Default true. */
  groupByRole?: boolean;
  /** Filter to specific roles (e.g. ["MONTEUR"] for assignee monteur). */
  allowedRoles?: UserRole[];
  /** Placeholder quand value null. */
  placeholder?: string;
  /** Texte du bouton "désaffecter". */
  unassignLabel?: string;
  /** Permet de désaffecter (null). Default true. */
  allowUnassign?: boolean;
  /** Empty message si pas de résultat. */
  emptyMessage?: ReactNode;
  disabled?: boolean;
  className?: string;
}

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN:              "Admin",
  VIDEASTE:           "Vidéaste",
  MONTEUR:            "Monteur",
  CM:                 "CM",
  EXTERNAL_GENERATOR: "Générateur externe",
  USER:               "Utilisateur",
};

const ROLE_CHIP_VARIANT: Record<UserRole, "default" | "peach" | "sage" | "sky" | "rose"> = {
  ADMIN:              "rose",
  VIDEASTE:           "peach",
  MONTEUR:            "peach",
  CM:                 "sage",
  EXTERNAL_GENERATOR: "sky",
  USER:               "default",
};

function roleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? role;
}

function roleVariant(role: UserRole): "default" | "peach" | "sage" | "sky" | "rose" {
  return ROLE_CHIP_VARIANT[role] ?? "default";
}

export function AssigneePicker({
  value,
  onChange,
  users,
  groupByRole = true,
  allowedRoles,
  placeholder = "Assigner…",
  unassignLabel = "Désaffecter",
  allowUnassign = true,
  emptyMessage = "Aucun utilisateur trouvé.",
  disabled = false,
  className,
}: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filteredUsers = allowedRoles
    ? users.filter((u) => allowedRoles.includes(u.role))
    : users;

  const selectedUser = users.find((u) => u.id === value) ?? null;

  // Close on outside click + ESC.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Group users by role.
  const groups = (() => {
    if (!groupByRole) return [["", filteredUsers]] as Array<[string, AssigneeUser[]]>;
    const map = new Map<UserRole, AssigneeUser[]>();
    for (const u of filteredUsers) {
      const arr = map.get(u.role) ?? [];
      arr.push(u);
      map.set(u.role, arr);
    }
    return Array.from(map.entries());
  })();

  return (
    <div ref={containerRef} className={["relative w-full", className ?? ""].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={[
          "flex items-center gap-2 w-full h-9 rounded-md px-2 text-[13px] text-left transition-colors",
          "bg-sky-50/40 backdrop-blur-[10px] backdrop-saturate-150",
          open
            ? "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(77,150,191,0.45),0_0_0_3px_rgba(169,209,230,0.4)]"
            : "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.08)] hover:bg-sky-50/55 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_1px_rgba(15,23,42,0.12)]",
          "focus-ring disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {selectedUser ? (
          <>
            <Avatar name={selectedUser.name} src={selectedUser.avatar} size="sm" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-gray-950 truncate leading-tight">
                {selectedUser.name}
              </span>
              <span className="block text-[10px] text-gray-500 leading-tight">{roleLabel(selectedUser.role)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/40 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] text-gray-400">
              <UserX size={12} />
            </span>
            <span className="flex-1 text-[13px] text-gray-400">{placeholder}</span>
          </>
        )}
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={[
            "absolute top-full left-0 right-0 mt-1.5 z-50 rounded-md overflow-hidden",
            "bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150",
            "shadow-[var(--shadow-glass-popover),var(--ring-glass-inset)]",
          ].join(" ")}
        >
          <Command shouldFilter={true}>
            <div className="flex items-center gap-2 border-b border-white/30 px-2.5 py-2">
              <Search size={14} className="shrink-0 text-gray-400" />
              <Command.Input
                placeholder="Rechercher (nom, email, rôle)…"
                className="flex-1 bg-transparent text-[13px] text-gray-950 placeholder:text-gray-400 outline-none"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto py-1">
              <Command.Empty className="px-3 py-3 text-[12px] text-gray-500">
                {emptyMessage}
              </Command.Empty>

              {allowUnassign && value !== null && (
                <Command.Item
                  value="__unassign"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="cursor-pointer inline-flex items-center gap-2 w-full px-3 py-2 text-[13px] text-rose-700 transition-colors data-[selected=true]:bg-rose-50/70 data-[selected=true]:backdrop-blur-[8px] data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.18)]"
                >
                  <UserX size={14} className="shrink-0" />
                  <span className="flex-1">{unassignLabel}</span>
                </Command.Item>
              )}

              {groups.map(([role, items]) => (
                <Command.Group
                  key={role || "_all"}
                  heading={groupByRole ? roleLabel(role) : undefined}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-gray-500"
                >
                  {items.map((user) => {
                    const isSel = user.id === value;
                    return (
                      <Command.Item
                        key={user.id}
                        value={user.id}
                        keywords={[user.name, user.email ?? "", roleLabel(user.role)]}
                        onSelect={() => {
                          onChange(user.id);
                          setOpen(false);
                        }}
                        className="cursor-pointer inline-flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors data-[selected=true]:bg-white/70 data-[selected=true]:backdrop-blur-[8px] data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.06)]"
                      >
                        <Avatar name={user.name} src={user.avatar} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-gray-950 truncate leading-tight">
                            {user.name}
                          </span>
                          {user.email && (
                            <span className="block text-[10px] text-gray-500 truncate leading-tight">{user.email}</span>
                          )}
                        </span>
                        {!groupByRole && (
                          <Chip variant={roleVariant(user.role)} size="sm">
                            {roleLabel(user.role)}
                          </Chip>
                        )}
                        {isSel && <Check size={14} className="shrink-0 text-gray-700" />}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
}
