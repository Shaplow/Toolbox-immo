"use client";

/**
 * UsersPanel — gestion des utilisateurs (refonte MID Liquid Glass).
 *
 * Cards user en glass franc + accordéon expanded pour la config (compte, outils,
 * templates, presets captions). Modal molecule pour création. Combobox pour
 * role, Switch primitive pour toggles outils, Chip pour assignations.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Plus, UserPlus, Search, Edit, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  TOOLS,
  TOOL_LABELS,
  TOOL_DESCRIPTIONS,
  EXTERNAL_GENERATOR_ALLOWED_TOOLS,
  type Tool,
} from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Combobox } from "@/components/ui/Combobox";
import { Switch } from "@/components/ui/Switch";
import { Chip } from "@/components/ui/Chip";
import { Avatar } from "@/components/ui/Avatar";
import { toast } from "@/components/ui/Toast";

type TemplateStub = { id: string; name: string; client: string };
type PresetStub = { id: string; name: string; isBuiltin: boolean };

type User = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  permissions: string;
  clientId: string | null;
  createdAt: string;
  accesses: { templateId: string; template: TemplateStub }[];
  captionPresetAccesses: string[];
  _count?: {
    assignedAsVideaste?: number;
    assignedAsMonteur?: number;
    assignedAsCm?: number;
  };
};

interface Props {
  templates: TemplateStub[];
  presets: PresetStub[];
  currentUserId: string;
  impersonatedUserId: string | null;
}

const ALL_TOOLS = Object.values(TOOLS) as Tool[];

const ROLE_OPTIONS = [
  { value: "EXTERNAL_GENERATOR", label: "Client externe" },
  { value: "VIDEASTE", label: "Vidéaste" },
  { value: "MONTEUR", label: "Monteur" },
  { value: "CM", label: "CM" },
  { value: "ADMIN", label: "Admin" },
];

const ROLE_VARIANT: Record<string, "default" | "peach" | "sage" | "sky" | "rose"> = {
  ADMIN: "rose",
  VIDEASTE: "peach",
  MONTEUR: "peach",
  CM: "sage",
  EXTERNAL_GENERATOR: "sky",
  USER: "default",
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  VIDEASTE: "Vidéaste",
  MONTEUR: "Monteur",
  CM: "CM",
  EXTERNAL_GENERATOR: "Client externe",
  USER: "User",
};

export function UsersPanel({ templates, presets, currentUserId, impersonatedUserId }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    role: "EXTERNAL_GENERATOR",
  });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", email: "", password: "" });
  const [activeImpersonationId, setActiveImpersonationId] = useState<string | null>(
    impersonatedUserId,
  );
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // Liste des agences pour le rattachement des comptes externes (bons de commande).
    void (async () => {
      try {
        const res = await fetch("/api/admin/clients");
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; name: string }[] | { clients?: { id: string; name: string }[] };
        setClients(Array.isArray(data) ? data : (data.clients ?? []));
      } catch {
        // silencieux — le picker affichera « aucun client »
      }
    })();
  }, []);

  async function handleClientChange(user: User, newClientId: string) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: newClientId || null }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Échec du rattachement client.");
      return;
    }
    toast.success(newClientId ? "Client rattaché." : "Client détaché.");
    await fetchUsers();
  }

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = (await res.json()) as Omit<User, "captionPresetAccesses">[];
    const withAccesses: User[] = await Promise.all(
      data.map(async (u) => {
        const r = await fetch(`/api/admin/users/${u.id}/caption-preset-accesses`);
        const presetIds: string[] = r.ok ? ((await r.json()) as string[]) : [];
        return { ...u, captionPresetAccesses: presetIds };
      }),
    );
    setUsers(withAccesses);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (q) {
        const hay = `${u.name} ${u.username} ${u.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setNewUser({ username: "", name: "", email: "", password: "", role: "EXTERNAL_GENERATOR" });
      setCreating(false);
      toast.success("Utilisateur créé.");
      await fetchUsers();
    } catch {
      toast.error("Erreur lors de la création.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Erreur lors de la suppression.");
      return;
    }
    toast.success("Utilisateur supprimé.");
    await fetchUsers();
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setEditForm({
      name: user.name,
      username: user.username,
      email: user.email ?? "",
      password: "",
    });
  }

  async function handleEdit(e: React.FormEvent, userId: string) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string> = {
        name: editForm.name,
        username: editForm.username,
        email: editForm.email,
      };
      if (editForm.password) body.password = editForm.password;
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setEditingId(null);
      toast.success("Compte mis à jour.");
      await fetchUsers();
    } catch {
      toast.error("Erreur lors de la modification.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(user: User, newRole: string) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Erreur lors du changement de rôle");
      return;
    }
    toast.success(`Rôle mis à jour pour ${user.name}.`);
    await fetchUsers();
  }

  async function handleToolToggle(user: User, tool: Tool) {
    const current: Tool[] = JSON.parse(user.permissions || "[]") as Tool[];
    const adding = !current.includes(tool);
    const next = adding ? [...current, tool] : current.filter((t) => t !== tool);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: next }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(d.error ?? "Erreur lors de la modification de l'outil");
      return;
    }
    toast.success(adding ? `Outil « ${tool} » ajouté.` : `Outil « ${tool} » retiré.`);
    await fetchUsers();
  }

  async function handleGrantTemplate(userId: string, templateId: string) {
    const res = await fetch(`/api/admin/users/${userId}/accesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    if (!res.ok) {
      toast.error("Impossible d'attribuer ce template");
      return;
    }
    toast.success("Template attribué.");
    await fetchUsers();
  }

  async function handleRevokeTemplate(userId: string, templateId: string) {
    const res = await fetch(`/api/admin/users/${userId}/accesses`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    if (!res.ok) {
      toast.error("Impossible de retirer ce template");
      return;
    }
    toast.success("Template retiré.");
    await fetchUsers();
  }

  async function handleGrantPreset(userId: string, presetId: string) {
    const res = await fetch(`/api/admin/users/${userId}/caption-preset-accesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    if (!res.ok) {
      toast.error("Impossible d'attribuer ce preset");
      return;
    }
    toast.success("Preset attribué.");
    await fetchUsers();
  }

  async function handleRevokePreset(userId: string, presetId: string) {
    const res = await fetch(`/api/admin/users/${userId}/caption-preset-accesses`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    if (!res.ok) {
      toast.error("Impossible de retirer ce preset");
      return;
    }
    toast.success("Preset retiré.");
    await fetchUsers();
  }

  async function handleImpersonation(user: User) {
    if (activeImpersonationId === user.id) {
      await fetch("/api/admin/impersonation", { method: "DELETE" });
      setActiveImpersonationId(null);
      router.push("/admin/users");
      router.refresh();
      return;
    }

    const res = await fetch("/api/admin/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) return;
    setActiveImpersonationId(user.id);
    router.push("/home");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-card border border-border py-12  flex items-center justify-center text-muted-foreground gap-3">
        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-[12.5px]">Chargement…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-[260px]">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Rechercher (nom, identifiant, email)"
              icon={Search}
            />
          </div>
          <div className="w-[180px]">
            <Combobox
              value={roleFilter}
              onChange={setRoleFilter}
              options={[{ value: "", label: "Tous les rôles" }, ...ROLE_OPTIONS]}
              placeholder="Tous les rôles"
              emptyMessage="—"
            />
          </div>
          <span className="text-[10.5px] text-muted-foreground tabular-nums">
            {filteredUsers.length}/{users.length} utilisateurs
          </span>
        </div>
        <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setCreating(true)}>
          Créer un utilisateur
        </Button>
      </div>

      {/* Liste */}
      {users.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-8 ">
          <EmptyState
            icon={UserPlus}
            title="Aucun utilisateur"
            description="Créez le premier utilisateur pour commencer."
            cta={{ label: "Créer un utilisateur", onClick: () => setCreating(true) }}
          />
        </div>
      ) : filteredUsers.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic text-center py-8">
          Aucun utilisateur ne correspond à la recherche.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => {
            const isExpanded = expandedId === user.id;
            const isAdmin = user.role === "ADMIN";
            const userTools: Tool[] = (() => {
              try {
                return JSON.parse(user.permissions) as Tool[];
              } catch {
                return [];
              }
            })();
            const assignedTemplateIds = new Set(user.accesses.map((a) => a.templateId));
            const unassignedTemplates = templates.filter((t) => !assignedTemplateIds.has(t.id));
            const assignedPresetIds = new Set(user.captionPresetAccesses);
            const unassignedPresets = presets.filter((p) => !assignedPresetIds.has(p.id));

            // Casquettes
            const wornHats: string[] = [];
            if ((user._count?.assignedAsVideaste ?? 0) > 0) {
              wornHats.push(`V·${user._count!.assignedAsVideaste}`);
            }
            if ((user._count?.assignedAsMonteur ?? 0) > 0) {
              wornHats.push(`M·${user._count!.assignedAsMonteur}`);
            }
            if ((user._count?.assignedAsCm ?? 0) > 0) {
              wornHats.push(`CM·${user._count!.assignedAsCm}`);
            }

            return (
              <div
                key={user.id}
                className="rounded-2xl bg-card border border-border  overflow-hidden"
              >
                {/* User header row */}
                <div className="px-5 py-4 flex items-center gap-4">
                  <Avatar
                    name={user.name}
                    size="md"
                    status={
                      activeImpersonationId === user.id
                        ? "away"
                        : user.id === currentUserId
                        ? "online"
                        : undefined
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-foreground truncate">{user.name}</p>
                      <Chip variant={ROLE_VARIANT[user.role] ?? "default"} size="sm">
                        {ROLE_LABEL[user.role] ?? user.role}
                      </Chip>
                      {wornHats.length > 0 && (
                        <Chip variant="rose" size="sm">
                          {wornHats.join(" · ")}
                        </Chip>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {user.username && <span className="font-mono">{user.username}</span>}
                      {user.username && user.email && " · "}
                      {user.email}
                    </p>
                  </div>

                  {!isAdmin && user.id !== currentUserId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Eye}
                      onClick={() => void handleImpersonation(user)}
                      title={
                        activeImpersonationId === user.id
                          ? "Arrêter l'impersonation"
                          : "Voir l'app en tant que cet utilisateur"
                      }
                    >
                      {activeImpersonationId === user.id ? "Arrêter" : "Voir comme"}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    icon={isExpanded ? ChevronUp : ChevronDown}
                    onClick={() => {
                      setExpandedId(isExpanded ? null : user.id);
                      setEditingId(null);
                    }}
                  >
                    {isExpanded ? "Fermer" : "Configurer"}
                  </Button>

                  {user.id !== currentUserId && (
                    <DeleteButton
                      itemLabel={`l'utilisateur "${user.name}"`}
                      description="L'utilisateur sera définitivement supprimé ainsi que tous ses accès."
                      onConfirm={() => handleDelete(user.id)}
                    />
                  )}
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-border bg-card border border-border divide-y divide-white/30">
                    {/* Edit account section */}
                    <div className="px-5 py-4">
                      {editingId === user.id ? (
                        <form
                          onSubmit={(e) => {
                            void handleEdit(e, user.id);
                          }}
                          className="space-y-3"
                        >
                          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                            Modifier le compte
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <FormField label="Nom" required>
                              <Input
                                type="text"
                                required
                                value={editForm.name}
                                onChange={(v) => setEditForm({ ...editForm, name: v })}
                              />
                            </FormField>
                            <FormField label="Identifiant" required>
                              <Input
                                type="text"
                                required
                                value={editForm.username}
                                onChange={(v) => setEditForm({ ...editForm, username: v })}
                              />
                            </FormField>
                            <FormField label="Email">
                              <Input
                                type="email"
                                value={editForm.email}
                                onChange={(v) => setEditForm({ ...editForm, email: v })}
                              />
                            </FormField>
                            <FormField
                              label="Nouveau mot de passe"
                              help="Laisser vide pour ne pas changer"
                            >
                              <Input
                                type="password"
                                value={editForm.password}
                                onChange={(v) => setEditForm({ ...editForm, password: v })}
                                placeholder="••••••••"
                              />
                            </FormField>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(null)}
                            >
                              Annuler
                            </Button>
                            <Button type="submit" variant="primary" size="sm" loading={saving}>
                              Enregistrer
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                              Compte
                            </p>
                            <div className="w-[180px]">
                              <Combobox
                                value={user.role}
                                onChange={(v) => void handleRoleChange(user, v)}
                                options={ROLE_OPTIONS}
                                disabled={user.id === currentUserId}
                              />
                            </div>
                            {user.role === "EXTERNAL_GENERATOR" && (
                              <>
                                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                                  Agence
                                </p>
                                <div className="w-[200px]">
                                  <Combobox
                                    value={user.clientId ?? ""}
                                    onChange={(v) => void handleClientChange(user, v)}
                                    options={[
                                      { value: "", label: "— Aucune" },
                                      ...clients.map((c) => ({ value: c.id, label: c.name })),
                                    ]}
                                    placeholder="Rattacher à un client…"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" icon={Edit} onClick={() => startEdit(user)}>
                            Modifier
                          </Button>
                        </div>
                      )}
                    </div>

                    {isAdmin ? (
                      <div className="px-5 py-4 bg-danger-50/40">
                        <p className="text-[12px] text-danger-700">
                          <span className="font-semibold">Administrateur</span> — tous les outils
                          et templates sont accessibles automatiquement.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Tools section */}
                        <div className="px-5 py-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                              Outils
                            </p>
                            {user.role === "EXTERNAL_GENERATOR" && (
                              <p className="text-[10px] text-muted-foreground italic">
                                Client externe : {EXTERNAL_GENERATOR_ALLOWED_TOOLS.join(", ")} uniquement
                              </p>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {ALL_TOOLS.map((tool) => {
                              const active = userTools.includes(tool);
                              const isAllowedForRole =
                                user.role !== "EXTERNAL_GENERATOR" ||
                                (EXTERNAL_GENERATOR_ALLOWED_TOOLS as readonly Tool[]).includes(tool);
                              const isLegacy = active && !isAllowedForRole;
                              const isBlocked = !active && !isAllowedForRole;
                              return (
                                <div
                                  key={tool}
                                  className={[
                                    "flex items-center gap-3 p-3 rounded-xl transition-all",
                                    isBlocked
                                      ? "bg-muted/40 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)] opacity-60"
                                      : isLegacy
                                      ? "bg-warning-50/60 "
                                      : active
                                      ? "bg-info-50/60 "
                                      : "bg-muted ",
                                  ].join(" ")}
                                  title={
                                    isBlocked
                                      ? "Non attribuable au rôle Client externe"
                                      : isLegacy
                                      ? "Permission héritée — peut être retirée mais pas re-ajoutée"
                                      : undefined
                                  }
                                >
                                  <Switch
                                    checked={active}
                                    onChange={() => handleToolToggle(user, tool)}
                                    disabled={isBlocked}
                                    size="sm"
                                    accent="default"
                                  />
                                  <div className="min-w-0">
                                    <p
                                      className={`text-[12px] font-semibold flex items-center gap-1.5 ${
                                        isBlocked
                                          ? "text-muted-foreground"
                                          : isLegacy
                                          ? "text-warning-700"
                                          : active
                                          ? "text-info-700"
                                          : "text-foreground"
                                      }`}
                                    >
                                      {TOOL_LABELS[tool]}
                                      {isLegacy && (
                                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-warning-100/80 text-warning-700">
                                          legacy
                                        </span>
                                      )}
                                    </p>
                                    <p
                                      className={`text-[10.5px] mt-0.5 ${
                                        isBlocked ? "text-muted-foreground/60" : "text-muted-foreground"
                                      }`}
                                    >
                                      {TOOL_DESCRIPTIONS[tool]}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Templates section */}
                        <div className="px-5 py-4 space-y-3">
                          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                            Templates assignés
                          </p>
                          {user.accesses.length === 0 ? (
                            <p className="text-[12px] text-muted-foreground italic">
                              Aucun template assigné.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {user.accesses.map((a) => (
                                <Chip
                                  key={a.templateId}
                                  variant="sky"
                                  onRemove={() => void handleRevokeTemplate(user.id, a.templateId)}
                                >
                                  {a.template.name}
                                  {a.template.client && (
                                    <span className="text-info-600/70 ml-1">· {a.template.client}</span>
                                  )}
                                </Chip>
                              ))}
                            </div>
                          )}
                          {unassignedTemplates.length > 0 && (
                            <details className="group">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
                                <Plus size={11} />
                                Ajouter un template ({unassignedTemplates.length} dispo)
                              </summary>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {unassignedTemplates.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => void handleGrantTemplate(user.id, t.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground bg-muted hover:bg-card border border-border  hover: transition-all"
                                  >
                                    <Plus size={10} />
                                    {t.name}
                                    {t.client && ` · ${t.client}`}
                                  </button>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>

                        {/* Caption presets section */}
                        {userTools.includes(TOOLS.CAPTIONS) && (
                          <div className="px-5 py-4 space-y-3">
                            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                              Presets de sous-titres assignés
                            </p>
                            {user.captionPresetAccesses.length === 0 ? (
                              <p className="text-[11px] text-warning-700 bg-warning-50/70 rounded-md px-3 py-2 shadow-[inset_0_0_0_1px_rgba(245,158,107,0.2)]">
                                Aucun preset assigné — l&apos;utilisateur verra une galerie vide.
                                Assignez au moins un preset ci-dessous.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {user.captionPresetAccesses.map((presetId) => {
                                  const preset = presets.find((p) => p.id === presetId);
                                  if (!preset) return null;
                                  return (
                                    <Chip
                                      key={presetId}
                                      variant="rose"
                                      onRemove={() =>
                                        void handleRevokePreset(user.id, presetId)
                                      }
                                    >
                                      {preset.name}
                                      {preset.isBuiltin && (
                                        <span className="text-danger-600/70 ml-1">· intégré</span>
                                      )}
                                    </Chip>
                                  );
                                })}
                              </div>
                            )}
                            {unassignedPresets.length > 0 && (
                              <details className="group">
                                <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
                                  <Plus size={11} />
                                  Ajouter un preset ({unassignedPresets.length} dispo)
                                </summary>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {unassignedPresets.map((p) => (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => void handleGrantPreset(user.id, p.id)}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground bg-muted hover:bg-card border border-border  hover: transition-all"
                                    >
                                      <Plus size={10} />
                                      {p.name}
                                      {p.isBuiltin && " (intégré)"}
                                    </button>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal création */}
      <Modal open={creating} onClose={() => !saving && setCreating(false)} size="md">
        <Modal.Header onClose={() => !saving && setCreating(false)}>
          Nouvel utilisateur
        </Modal.Header>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="contents"
        >
          <Modal.Body>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Identifiant" required>
                <Input
                  type="text"
                  required
                  value={newUser.username}
                  onChange={(v) => setNewUser({ ...newUser, username: v })}
                  placeholder="marie.dupont"
                />
              </FormField>
              <FormField label="Nom" required>
                <Input
                  type="text"
                  required
                  value={newUser.name}
                  onChange={(v) => setNewUser({ ...newUser, name: v })}
                  placeholder="Marie Dupont"
                />
              </FormField>
              <FormField label="Email">
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(v) => setNewUser({ ...newUser, email: v })}
                  placeholder="marie@agence.fr"
                />
              </FormField>
              <FormField label="Mot de passe" required>
                <Input
                  type="password"
                  required
                  value={newUser.password}
                  onChange={(v) => setNewUser({ ...newUser, password: v })}
                  placeholder="••••••••"
                />
              </FormField>
              <div className="col-span-2">
                <FormField
                  label="Rôle"
                  help="Un Admin peut être assigné comme vidéaste, monteur ou CM sur n'importe quel slot (et basculer en vue dédiée via la navbar). Choisissez un rôle dédié pour un user qui assume une seule casquette."
                >
                  <Combobox
                    value={newUser.role}
                    onChange={(v) => setNewUser({ ...newUser, role: v })}
                    options={ROLE_OPTIONS}
                  />
                </FormField>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={saving} icon={Plus}>
              Créer
            </Button>
          </Modal.Footer>
        </form>
      </Modal>

    </div>
  );
}
