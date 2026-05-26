"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { ToolPageHeader } from "@/components/layout/ToolPageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";

export interface ClientItem {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  accounts: { id: string; name: string; handle: string }[];
}

interface Props {
  initialClients: ClientItem[];
}

const EMPTY_FORM = { name: "", contactName: "", email: "", phone: "" };

export function ClientsListAdmin({ initialClients }: Props) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientItem[]>(initialClients);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newClient, setNewClient] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contactName ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        c.accounts.some((a) => a.handle.toLowerCase().includes(q)),
    );
  }, [clients, search]);

  // ESC pour fermer la modale. Le focus initial est géré par autoFocus sur l'input.
  useEffect(() => {
    if (!showCreate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCreate(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showCreate]);

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
      if (!res.ok || data.error) {
        toast.error(data.error ?? "Erreur lors de la création.");
        return;
      }
      setNewClient(EMPTY_FORM);
      setShowCreate(false);
      toast.success("Client créé.");
      router.refresh();
    } catch {
      toast.error("Erreur lors de la création.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(clientId: string) {
    const res = await fetch(`/api/admin/clients/${clientId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Erreur lors de la suppression.");
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    toast.success("Client supprimé.");
    router.refresh();
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <ToolPageHeader
        icon={Building2}
        iconColor="indigo"
        title="Clients"
        subtitle="Gérez les clients et leur rattachement aux comptes Instagram."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>
            Nouveau client
          </Button>
        }
      />

      {/* Search bar */}
      {clients.length > 0 && (
        <div className="mb-5 max-w-sm">
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Rechercher par nom, contact, email ou @handle…"
          />
        </div>
      )}

      {/* Liste */}
      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun client"
          description="Créez le premier client pour commencer."
          cta={{ label: "Nouveau client", onClick: () => setShowCreate(true) }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucun résultat"
          description="Modifiez votre recherche pour voir d'autres clients."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((client) => (
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

      {/* Modale création */}
      {showCreate && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => !saving && setShowCreate(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-client-title"
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
          >
            <form
              onSubmit={(e) => { void handleCreate(e); }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg pointer-events-auto overflow-hidden"
            >
              <div className="px-6 pt-6 pb-3">
                <h2 id="new-client-title" className="text-base font-semibold text-gray-900 mb-1">
                  Nouveau client
                </h2>
                <p className="text-sm text-gray-600">Renseignez les informations de contact (le nom est obligatoire).</p>
              </div>
              <div className="px-6 pb-4 grid grid-cols-2 gap-3">
                <FormField label="Nom" required>
                  <Input
                    autoFocus
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
              <div className="flex items-center justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreate(false)}
                  disabled={saving}
                >
                  Annuler
                </Button>
                <Button type="submit" variant="primary" loading={saving}>
                  Créer
                </Button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
