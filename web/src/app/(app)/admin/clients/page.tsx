"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

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
  const [saving, setSaving] = useState(false);

  const fetchClients = useCallback(async () => {
    const res = await fetch("/api/admin/clients");
    if (res.ok) {
      setClients(await res.json() as Client[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchClients(); }, [fetchClients]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClient),
      });
      const data = await res.json() as { error?: string };
      if (data.error) { toast.error(data.error); return; }
      setNewClient({ name: "", contactName: "", email: "", phone: "" });
      setCreating(false);
      toast.success("Client créé.");
      await fetchClients();
    } catch {
      toast.error("Erreur lors de la création.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(clientId: string) {
    const res = await fetch(`/api/admin/clients/${clientId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Erreur lors de la suppression."); return; }
    toast.success("Client supprimé.");
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
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Nouveau client
          </Button>
        }
      />

      <div className="space-y-4">
        {/* Create form */}
        {creating && (
          <form onSubmit={(e) => { void handleCreate(e); }} className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-indigo-800">Nouveau client</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Nom" required>
                <Input
                  type="text"
                  required
                  value={newClient.name}
                  onChange={(v) => setNewClient({ ...newClient, name: v })}
                  placeholder="Agence Martin"
                />
              </FormField>
              <FormField label="Contact" help="Optionnel">
                <Input
                  type="text"
                  value={newClient.contactName}
                  onChange={(v) => setNewClient({ ...newClient, contactName: v })}
                  placeholder="Jean Martin"
                />
              </FormField>
              <FormField label="Email" help="Optionnel">
                <Input
                  type="email"
                  value={newClient.email}
                  onChange={(v) => setNewClient({ ...newClient, email: v })}
                  placeholder="jean@agence.fr"
                />
              </FormField>
              <FormField label="Téléphone" help="Optionnel">
                <Input
                  type="tel"
                  value={newClient.phone}
                  onChange={(v) => setNewClient({ ...newClient, phone: v })}
                  placeholder="06 00 00 00 00"
                />
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

        {/* Clients list */}
        {clients.length === 0 && !creating ? (
          <EmptyState
            icon={Building2}
            title="Aucun client"
            description="Créez le premier client pour commencer."
            cta={{ label: "Nouveau client", onClick: () => setCreating(true) }}
          />
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
                  <DeleteButton
                    itemLabel="ce client"
                    description="Le client sera définitivement supprimé."
                    onConfirm={() => handleDelete(client.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
