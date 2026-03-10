"use client";

import { useState, useEffect, useCallback } from "react";
import { TOOLS, TOOL_LABELS, TOOL_DESCRIPTIONS, type Tool } from "@/lib/permissions";

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
}

const ALL_TOOLS = Object.values(TOOLS) as Tool[];

export function UsersPanel({ templates, presets }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", name: "", email: "", password: "", role: "USER" });
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", username: "", email: "", password: "" });
  const [editError, setEditError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
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

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setSaving(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    const data = await res.json() as { error?: string };
    setSaving(false);
    if (data.error) { setCreateError(data.error); return; }
    setNewUser({ username: "", name: "", email: "", password: "", role: "USER" });
    setCreating(false);
    await fetchUsers();
  }

  async function handleDelete(userId: string) {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    await fetchUsers();
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setEditForm({ name: user.name, username: user.username, email: user.email ?? "", password: "" });
    setEditError("");
  }

  async function handleEdit(e: React.FormEvent, userId: string) {
    e.preventDefault();
    setEditError("");
    setSaving(true);
    const body: Record<string, string> = { name: editForm.name, username: editForm.username, email: editForm.email };
    if (editForm.password) body.password = editForm.password;
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { error?: string };
    setSaving(false);
    if (data.error) { setEditError(data.error); return; }
    setEditingId(null);
    await fetchUsers();
  }

  async function handleRoleToggle(user: User) {
    const newRole = user.role === "ADMIN" ? "USER" : "ADMIN";
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
        <button
          onClick={() => { setCreating(true); setCreateError(""); }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Creer un utilisateur
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={handleCreate} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-indigo-800">Nouvel utilisateur</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Identifiant <span className="text-red-400">*</span></span>
              <input type="text" required value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="marie.dupont"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Nom <span className="text-red-400">*</span></span>
              <input type="text" required value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Marie Dupont"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Email <span className="text-gray-300">(optionnel)</span></span>
              <input type="email" value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="marie@agence.fr"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Mot de passe <span className="text-red-400">*</span></span>
              <input type="password" required value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="..."
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Role</span>
              <select value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="USER">Utilisateur</option>
                <option value="ADMIN">Administrateur</option>
              </select>
            </label>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={() => setCreating(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
              {saving ? "Creation..." : "Creer"}
            </button>
          </div>
        </form>
      )}

      {/* Users list */}
      {users.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-12">Aucun autre utilisateur.</p>
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
                  {/* Role badge */}
                  <button
                    onClick={() => handleRoleToggle(user)}
                    title="Cliquer pour changer le role"
                    className={`shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                      isAdmin
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                        : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {isAdmin ? "Admin" : "Utilisateur"}
                  </button>
                  <button
                    onClick={() => { setExpandedId(isExpanded ? null : user.id); setEditingId(null); }}
                    className="shrink-0 text-xs text-gray-400 hover:text-indigo-700 transition-colors px-2"
                  >
                    {isExpanded ? "Fermer ▲" : "Configurer ▼"}
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    title="Supprimer l'utilisateur"
                    className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm"
                  >
                    x
                  </button>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-50 bg-gray-50/50 divide-y divide-gray-100">

                    {/* Edit account section */}
                    <div className="px-5 py-4">
                      {editingId === user.id ? (
                        <form onSubmit={(e) => handleEdit(e, user.id)} className="space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Modifier le compte</p>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-gray-500">Nom</span>
                              <input type="text" required value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-gray-500">Identifiant</span>
                              <input type="text" required value={editForm.username}
                                onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-gray-500">Email</span>
                              <input type="email" value={editForm.email}
                                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-xs text-gray-500">Nouveau mot de passe <span className="text-gray-300">(laisser vide pour ne pas changer)</span></span>
                              <input type="password" value={editForm.password}
                                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                                placeholder="••••••••"
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </label>
                          </div>
                          {editError && <p className="text-xs text-red-500">{editError}</p>}
                          <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Annuler</button>
                            <button type="submit" disabled={saving}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                              {saving ? "Enregistrement..." : "Enregistrer"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Compte</p>
                          <button onClick={() => startEdit(user)}
                            className="text-xs text-indigo-700 hover:text-indigo-700 font-medium">Modifier ✎</button>
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
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outils</p>
                          <div className="flex flex-col gap-2">
                            {ALL_TOOLS.map((tool) => {
                              const active = userTools.includes(tool);
                              return (
                                <label
                                  key={tool}
                                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    active ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-100 hover:border-gray-200"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => handleToolToggle(user, tool)}
                                    className="accent-indigo-600 shrink-0"
                                  />
                                  <div>
                                    <p className={`text-xs font-semibold ${active ? "text-indigo-800" : "text-gray-700"}`}>
                                      {TOOL_LABELS[tool]}
                                    </p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">{TOOL_DESCRIPTIONS[tool]}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Templates section */}
                        <div className="px-5 py-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Templates assignes</p>
                          {user.accesses.length === 0 ? (
                            <p className="text-xs text-gray-400">Aucun template assigne.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {user.accesses.map((a) => (
                                <div key={a.templateId} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                                  <span className="text-xs text-gray-700 font-medium">{a.template.name}</span>
                                  {a.template.client && <span className="text-xs text-indigo-700">· {a.template.client}</span>}
                                  <button onClick={() => handleRevokeTemplate(user.id, a.templateId)}
                                    className="text-gray-300 hover:text-red-400 transition-colors ml-1 text-xs">x</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {unassignedTemplates.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {unassignedTemplates.map((t) => (
                                <button key={t.id} onClick={() => handleGrantTemplate(user.id, t.id)}
                                  className="text-xs px-3 py-1.5 border border-dashed border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 transition-colors">
                                  + {t.name}{t.client ? ` · ${t.client}` : ""}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Caption presets section */}
                        <div className="px-5 py-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Presets captions assignes</p>
                          {user.captionPresetAccesses.length === 0 ? (
                            <p className="text-xs text-gray-400">Aucun preset assigne.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {user.captionPresetAccesses.map((presetId) => {
                                const preset = presets.find((p) => p.id === presetId);
                                if (!preset) return null;
                                return (
                                  <div key={presetId} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                                    <span className="text-xs text-gray-700 font-medium">{preset.name}</span>
                                    {preset.isBuiltin && <span className="text-[10px] text-violet-500">builtin</span>}
                                    <button onClick={() => handleRevokePreset(user.id, presetId)}
                                      className="text-gray-300 hover:text-red-400 transition-colors ml-1 text-xs">x</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {unassignedPresets.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {unassignedPresets.map((p) => (
                                <button key={p.id} onClick={() => handleGrantPreset(user.id, p.id)}
                                  className="text-xs px-3 py-1.5 border border-dashed border-violet-300 text-violet-600 rounded-lg hover:bg-violet-50 transition-colors">
                                  + {p.name}{p.isBuiltin ? " (builtin)" : ""}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
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
