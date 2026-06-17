"use client";

/**
 * AssigneePicker — sélecteur d'utilisateur avec rôle + avatar.
 *
 * Factorise AssigneeSelect + AssigneeInlineEdit (PublicationHeader, SlotDetailPanel).
 *
 * Flat shadcn :
 * - Trigger : bg-card border-input.
 * - Popover : bg-popover border-border shadow-lg.
 * - Items : Avatar + nom + email muted + chip role.
 * - Groupés par rôle (default true).
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
  groupByRole?: boolean;
  allowedRoles?: UserRole[];
  placeholder?: string;
  unassignLabel?: string;
  allowUnassign?: boolean;
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

function roleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? role;
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

  const triggerState = open
    ? "border-primary ring-2 ring-primary/30"
    : "border-input hover:border-zinc-300";

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
          "flex items-center gap-2 w-full h-9 rounded-md px-2 text-[13px] text-left transition-colors bg-card border",
          triggerState,
          "focus-ring disabled:opacity-50 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {selectedUser ? (
          <>
            <Avatar name={selectedUser.name} src={selectedUser.avatar} size="sm" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-foreground truncate leading-tight">
                {selectedUser.name}
              </span>
              <span className="block text-[10px] text-muted-foreground leading-tight">{roleLabel(selectedUser.role)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
              <UserX size={12} />
            </span>
            <span className="flex-1 text-[13px] text-muted-foreground">{placeholder}</span>
          </>
        )}
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-md overflow-hidden bg-popover text-popover-foreground border border-border shadow-lg">
          <Command shouldFilter={true}>
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <Command.Input
                placeholder="Rechercher (nom, email, rôle)…"
                className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto py-1">
              <Command.Empty className="px-3 py-3 text-[12px] text-muted-foreground">
                {emptyMessage}
              </Command.Empty>

              {allowUnassign && value !== null && (
                <Command.Item
                  value="__unassign"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="cursor-pointer inline-flex items-center gap-2 w-full px-3 py-2 text-[13px] text-danger-600 transition-colors data-[selected=true]:bg-danger-50 data-[selected=true]:text-danger-700"
                >
                  <UserX size={14} className="shrink-0" />
                  <span className="flex-1">{unassignLabel}</span>
                </Command.Item>
              )}

              {groups.map(([role, items]) => (
                <Command.Group
                  key={role || "_all"}
                  heading={groupByRole ? roleLabel(role) : undefined}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                        className="cursor-pointer inline-flex items-center gap-2.5 w-full px-3 py-2 text-[13px] transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      >
                        <Avatar name={user.name} src={user.avatar} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-foreground truncate leading-tight">
                            {user.name}
                          </span>
                          {user.email && (
                            <span className="block text-[10px] text-muted-foreground truncate leading-tight">{user.email}</span>
                          )}
                        </span>
                        {!groupByRole && (
                          <Chip variant="default" size="sm">
                            {roleLabel(user.role)}
                          </Chip>
                        )}
                        {isSel && <Check size={14} className="shrink-0 text-foreground" />}
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
