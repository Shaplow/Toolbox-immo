"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, Trash2 } from "lucide-react";
import Link from "next/link";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";

type AccountStub = { id: string; name: string; handle: string };
type Client = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  accounts: AccountStub[];
};

export default function AdminClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", contactName: "", email: "", phone: "" });
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    const res = await fetch("/api/admin/clients");
    if (res.ok) {
      setClients(await res.json() as Client[]);
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchClients(); }, [fetchClients]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setSaving(true);
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newClient),
    });
    const data = await res.json() as { error?: string };
    setSaving(false);
    if (data.error) { setCreateError(data.error); return; }
    setNewClient({ name: "", contactName: "", email: "", phone: "" });
    setCreating(false);
    await fetchClients();
  }

  async function handleDelete(clientId: string) {
    await fetch(`/api/admin/clients/${clientId}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    await fetchClients();
  }

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-center h-48 text-gray-400">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-3" />
          Chargement...
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={Building2}
        iconColor="indigo"
        title="Clients"
        subtitle="Gérez les clients et leur rattachement aux comptes Instagram."
        actions={
          <button
            onClick={() => { setCreating(true); setCreateError(""); }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Nouveau client
          </button>
        }
      />

      <div className="space-y-4">
        {/* Create form */}
        {creating && (
          <form onSubmit={handleCreate} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-indigo-800">Nouveau client</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Nom <span className="text-red-400">*</span></span>
                <input
                  type="text"
                  required
                  value={newClient.name}
                  onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  placeholder="Agence Martin"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Contact <span className="text-gray-300">(optionnel)</span></span>
                <input
                  type="text"
                  value={newClient.contactName}
                  onChange={(e) => setNewClient({ ...newClient, contactName: e.target.value })}
                  placeholder="Jean Martin"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Email <span className="text-gray-300">(optionnel)</span></span>
                <input
                  type="email"
                  value={newClient.email}
                  onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                  placeholder="jean@agence.fr"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Téléphone <span className="text-gray-300">(optionnel)</span></span>
                <input
                  type="tel"
                  value={newClient.phone}
                  onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                  placeholder="06 00 00 00 00"
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {saving ? "Création…" : "Créer"}
              </button>
            </div>
          </form>
        )}

        {/* Clients list */}
        {clients.length === 0 && !creating ? (
          <p className="text-center text-gray-400 text-sm py-12">Aucun client. Cliquez sur &ldquo;Nouveau client&rdquo; pour commencer.</p>
        ) : (
          <div className="space-y-3">
            {clients.map((client) => (
              <div key={client.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm shrink-0">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{client.name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {client.contactName && <span>{client.contactName}</span>}
                      {client.contactName && client.email && " · "}
                      {client.email && <span>{client.email}</span>}
                      {(client.contactName || client.email) && client.phone && " · "}
                      {client.phone && <span>{client.phone}</span>}
                    </p>
                  </div>
                  {client.accounts.length > 0 && (
                    <div className="flex flex-wrap gap-1 shrink-0 max-w-xs">
                      {client.accounts.map((a) => (
                        <span key={a.id} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          @{a.handle}
                        </span>
                      ))}
                    </div>
                  )}
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="shrink-0 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                  >
                    Configurer
                  </Link>
                  {confirmDeleteId === client.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => void handleDelete(client.id)}
                        className="text-xs px-2 py-1 bg-red-500 text-white rounded-md hover:bg-red-600"
                      >
                        Supprimer
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(client.id)}
                      title="Supprimer le client"
                      className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
