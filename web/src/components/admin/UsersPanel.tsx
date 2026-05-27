"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, X, Plus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { TOOLS, TOOL_LABELS, TOOL_DESCRIPTIONS, EXTERNAL_GENERATOR_ALLOWED_TOOLS, type Tool } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

type TemplateStub = { id: string; name: string; client: string };
type PresetStub   = { id: string; name: string; isBuiltin: boolean };

type User = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  permissions: string; // JSON: ["templates","captions"]
  createdAt: string;
  accesses: { templateId: string; template: TemplateStub }[];
  captionPresetAccesses: string[]; // array of presetIds
};

interface Props {
  templates: TemplateStub[];
  presets: PresetStub[];
  currentUserId: string;
  impersonatedUserId: string | null;
}

const ALL_TOOLS = Object.values(TOOLS) as Tool[];

export function UsersPanel({ templates, presets, currentUserId, impersonatedUserId }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", name: "", email: "", password: "", role: "EXTERNAL_GENERATOR" });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", email: "", password: "" });
  const [activeImpersonationId, setActiveImpersonationId] = useState<string | null>(impersonatedUserId);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json() as Omit<User, "captionPresetAccesses">[];
    // Fetch caption preset accesses for each user
    const withAccesses: User[] = await Promise.all(
      data.map(async (u) => {
        const r = await fetch(`/api/admin/users/${u.id}/caption-preset-accesses`);
        const presetIds: string[] = r.ok ? (await r.json() as string[]) : [];
        return { ...u, captionPresetAccesses: presetIds };
      })
    );
    setUsers(withAccesses);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json() as { error?: string };
      if (data.error) { toast.error(data.error); return; }
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
    if (!res.ok) { toast.error("Erreur lors de la suppression."); return; }
    toast.success("Utilisateur supprimé.");
    await fetchUsers();
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setEditForm({ name: user.name, username: user.username, email: user.email ?? "", password: "" });
  }

  async function handleEdit(e: React.FormEvent, userId: string) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, string> = { name: editForm.name, username: editForm.username, email: editForm.email };
      if (editForm.password) body.password = editForm.password;
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };
      if (data.error) { toast.error(data.error); return; }
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
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    await fetchUsers();
  }

  async function handleToolToggle(user: User, tool: Tool) {
    const current: Tool[] = JSON.parse(user.permissions || "[]") as Tool[];
    const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: next }),
    });
    await fetchUsers();
  }

  async function handleGrantTemplate(userId: string, templateId: string) {
    await fetch(`/api/admin/users/${userId}/accesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    await fetchUsers();
  }

  async function handleRevokeTemplate(userId: string, templateId: string) {
    await fetch(`/api/admin/users/${userId}/accesses`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    await fetchUsers();
  }

  async function handleGrantPreset(userId: string, presetId: string) {
    await fetch(`/api/admin/users/${userId}/caption-preset-accesses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    await fetchUsers();
  }

  async function handleRevokePreset(userId: string, presetId: string) {
    await fetch(`/api/admin/users/${userId}/caption-preset-accesses`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
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
      <div className="flex items-center justify-center h-48 text-gray-400">
        <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-3" />
        Chargement...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + create button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={UserPlus}
          onClick={() => setCreating(true)}
        >
          Créer un utilisateur
        </Button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={(e) => { void handleCreate(e); }} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-indigo-800">Nouvel utilisateur</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Identifiant" required>
              <Input type="text" required value={newUser.username}
                onChange={(v) => setNewUser({ ...newUser, username: v })}
                placeholder="marie.dupont" />
            </FormField>
            <FormField label="Nom" required>
              <Input type="text" required value={newUser.name}
                onChange={(v) => setNewUser({ ...newUser, name: v })}
                placeholder="Marie Dupont" />
            </FormField>
            <FormField label="Email" help="Optionnel">
              <Input type="email" value={newUser.email}
                onChange={(v) => setNewUser({ ...newUser, email: v })}
                placeholder="marie@agence.fr" />
            </FormField>
            <FormField label="Mot de passe" required>
              <Input type="password" required value={newUser.password}
                onChange={(v) => setNewUser({ ...newUser, password: v })}
                placeholder="..." />
            </FormField>
            <FormField label="Rôle">
              <select value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="EXTERNAL_GENERATOR">Client externe</option>
                <option value="ADMIN">Administrateur</option>
              </select>
            </FormField>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Créer
            </Button>
          </div>
        </form>
      )}

      {/* Users list */}
      {users.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Aucun utilisateur"
          description="Créez le premier utilisateur pour commencer."
          cta={{ label: "Créer un utilisateur", onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isExpanded = expandedId === user.id;
            const isAdmin = user.role === "ADMIN";
            const userTools: Tool[] = (() => { try { return JSON.parse(user.permissions) as Tool[]; } catch { return []; } })();
            const assignedTemplateIds = new Set(user.accesses.map((a) => a.templateId));
            const unassignedTemplates = templates.filter((t) => !assignedTemplateIds.has(t.id));
            const assignedPresetIds = new Set(user.captionPresetAccesses);
            const unassignedPresets = presets.filter((p) => !assignedPresetIds.has(p.id));

            return (
              <div key={user.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                {/* User header row */}
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{user.name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {user.username && <span className="font-mono">{user.username}</span>}
                      {user.username && user.email && " · "}
                      {user.email}
                    </p>
                  </div>
                  {!isAdmin && user.id !== currentUserId && (
                    <button
                      onClick={() => void handleImpersonation(user)}
                      className={`shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                        activeImpersonationId === user.id
                          ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
                          : "bg-white border-gray-200 text-gray-600 hover:border-amber-300 hover:text-amber-800"
                      }`}
                    >
                      {activeImpersonationId === user.id ? "Arrêter" : "Impersonate"}
                    </button>
                  )}
                  {/* Role dropdown */}
                  <select
                    value={user.role}
                    onChange={(e) => void handleRoleChange(user, e.target.value)}
                    disabled={user.id === currentUserId}
                    title="Rôle"
                    className="shrink-0 text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
                  >
                    <option value="EXTERNAL_GENERATOR">Client externe</option>
                    <option value="MONTEUR">Monteur</option>
                    <option value="CM">CM</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={isExpanded ? ChevronUp : ChevronDown}
                    onClick={() => { setExpandedId(isExpanded ? null : user.id); setEditingId(null); }}
                    className="shrink-0 text-gray-400 hover:text-indigo-700"
                  >
                    {isExpanded ? "Fermer" : "Configurer"}
                  </Button>
                  {user.id !== currentUserId && (
                    <DeleteButton
                      itemLabel="cet utilisateur"
                      description="L'utilisateur sera définitivement supprimé ainsi que tous ses accès."
                      onConfirm={() => handleDelete(user.id)}
                    />
                  )}
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-50 bg-gray-50/50 divide-y divide-gray-100">

                    {/* Edit account section */}
                    <div className="px-5 py-4">
                      {editingId === user.id ? (
                        <form onSubmit={(e) => { void handleEdit(e, user.id); }} className="space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Modifier le compte</p>
                          <div className="grid grid-cols-2 gap-3">
                            <FormField label="Nom" required>
                              <Input type="text" required value={editForm.name}
                                onChange={(v) => setEditForm({ ...editForm, name: v })} />
                            </FormField>
                            <FormField label="Identifiant" required>
                              <Input type="text" required value={editForm.username}
                                onChange={(v) => setEditForm({ ...editForm, username: v })} />
                            </FormField>
                            <FormField label="Email">
                              <Input type="email" value={editForm.email}
                                onChange={(v) => setEditForm({ ...editForm, email: v })} />
                            </FormField>
                            <FormField label="Nouveau mot de passe" help="Laisser vide pour ne pas changer">
                              <Input type="password" value={editForm.password}
                                onChange={(v) => setEditForm({ ...editForm, password: v })}
                                placeholder="••••••••" />
                            </FormField>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button type="button" variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                              Annuler
                            </Button>
                            <Button type="submit" variant="primary" size="sm" loading={saving}>
                              Enregistrer
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Compte</p>
                          <Button variant="ghost" size="sm" onClick={() => startEdit(user)}>
                            Modifier
                          </Button>
                        </div>
                      )}
                    </div>

                    {isAdmin ? (
                      <div className="px-5 py-3">
                        <p className="text-xs text-indigo-700 font-medium">
                          Administrateur — tous les outils et templates sont accessibles automatiquement.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Tools section */}
                        <div className="px-5 py-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outils</p>
                            {user.role === "EXTERNAL_GENERATOR" && (
                              <p className="text-[10px] text-gray-400 italic">
                                Rôle Client externe : seuls {EXTERNAL_GENERATOR_ALLOWED_TOOLS.join(", ")} sont attribuables
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            {ALL_TOOLS.map((tool) => {
                              const active = userTools.includes(tool);
                              // D4 étape 1 : USER ne peut pas se voir ajouter captions/transcription/description.
                              // Les héritées (active && !allowed) restent décochables pour permettre le nettoyage.
                              const isAllowedForRole = user.role !== "EXTERNAL_GENERATOR" || (EXTERNAL_GENERATOR_ALLOWED_TOOLS as readonly Tool[]).includes(tool);
                              const isLegacy = active && !isAllowedForRole;
                              const isBlocked = !active && !isAllowedForRole;
                              return (
                                <label
                                  key={tool}
                                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                    isBlocked
                                      ? "bg-gray-50 border-gray-100 cursor-not-allowed opacity-60"
                                      : isLegacy
                                        ? "bg-amber-50 border-amber-200 cursor-pointer"
                                        : active
                                          ? "bg-indigo-50 border-indigo-200 cursor-pointer"
                                          : "bg-white border-gray-100 hover:border-gray-200 cursor-pointer"
                                  }`}
                                  title={
                                    isBlocked
                                      ? "Non attribuable au rôle Client externe"
                                      : isLegacy
                                        ? "Permission héritée — peut être retirée mais pas re-ajoutée pour ce rôle"
                                        : undefined
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => handleToolToggle(user, tool)}
                                    disabled={isBlocked}
                                    className="accent-indigo-600 shrink-0"
                                  />
                                  <div>
                                    <p className={`text-xs font-semibold flex items-center gap-1.5 ${
                                      isBlocked ? "text-gray-400" : isLegacy ? "text-amber-800" : active ? "text-indigo-800" : "text-gray-700"
                                    }`}>
                                      {TOOL_LABELS[tool]}
                                      {isLegacy && (
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                                          legacy
                                        </span>
                                      )}
                                    </p>
                                    <p className={`text-[10px] mt-0.5 ${isBlocked ? "text-gray-300" : "text-gray-400"}`}>
                                      {TOOL_DESCRIPTIONS[tool]}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Templates section */}
                        <div className="px-5 py-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Templates assignés</p>
                          {user.accesses.length === 0 ? (
                            <p className="text-xs text-gray-400">Aucun template assigné.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {user.accesses.map((a) => (
                                <div key={a.templateId} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                                  <span className="text-xs text-gray-700 font-medium">{a.template.name}</span>
                                  {a.template.client && <span className="text-xs text-indigo-700">· {a.template.client}</span>}
                                  <button onClick={() => void handleRevokeTemplate(user.id, a.templateId)}
                                    className="text-gray-300 hover:text-red-400 transition-colors ml-1"><X size={10} /></button>
                                </div>
                              ))}
                            </div>
                          )}
                          {unassignedTemplates.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {unassignedTemplates.map((t) => (
                                <Button key={t.id} variant="secondary" size="sm" icon={Plus}
                                  onClick={() => void handleGrantTemplate(user.id, t.id)}
                                  className="border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                                  {t.name}{t.client ? ` · ${t.client}` : ""}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Caption presets section — only relevant when captions tool is enabled */}
                        {userTools.includes(TOOLS.CAPTIONS) && (
                        <div className="px-5 py-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Presets de sous-titres assignés</p>
                          {user.captionPresetAccesses.length === 0 ? (
                            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              Aucun preset assigné — l&apos;utilisateur verra une galerie vide. Assignez au moins un preset ci-dessous.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {user.captionPresetAccesses.map((presetId) => {
                                const preset = presets.find((p) => p.id === presetId);
                                if (!preset) return null;
                                return (
                                  <div key={presetId} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                                    <span className="text-xs text-gray-700 font-medium">{preset.name}</span>
                                    {preset.isBuiltin && <span className="text-[10px] text-violet-500">intégré</span>}
                                    <button onClick={() => void handleRevokePreset(user.id, presetId)}
                                      className="text-gray-300 hover:text-red-400 transition-colors ml-1"><X size={10} /></button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {unassignedPresets.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {unassignedPresets.map((p) => (
                                <Button key={p.id} variant="secondary" size="sm" icon={Plus}
                                  onClick={() => void handleGrantPreset(user.id, p.id)}
                                  className="border-dashed border-violet-300 text-violet-600 hover:bg-violet-50">
                                  {p.name}{p.isBuiltin ? " (intégré)" : ""}
                                </Button>
                              ))}
                            </div>
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
    </div>
  );
}
