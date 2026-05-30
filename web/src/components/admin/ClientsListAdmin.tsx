"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, Search, Mail, Phone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Chip } from "@/components/ui/Chip";
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

  const totalAccounts = useMemo(
    () => clients.reduce((acc, c) => acc + c.accounts.length, 0),
    [clients],
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClient),
      });
      const data = (await res.json()) as { error?: string };
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
    <div className="min-h-screen">
      <div
        className="my-11 ml-[60px] mr-[100px] rounded-3xl min-h-[calc(100vh-5.5rem)] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.10)]"
        style={{
          background: "var(--gradient-page-shell)",
        }}
      >
        {/* Header Control Center */}
        <div className="rounded-t-3xl overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-6 pb-2">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                  Configuration
                </p>
                <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-gray-950 leading-[1.05]">
                  Clients
                </h1>
                <p className="mt-2 text-[13px] text-gray-500">
                  {clients.length} client{clients.length !== 1 ? "s" : ""}
                  {totalAccounts > 0 && (
                    <>
                      {" · "}
                      <span className="tabular-nums">
                        {totalAccounts} compte{totalAccounts !== 1 ? "s" : ""} Instagram
                      </span>
                    </>
                  )}
                </p>
              </div>

              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                onClick={() => setShowCreate(true)}
              >
                Nouveau client
              </Button>
            </div>
          </div>
        </div>

        {/* Inner content */}
        <div className="pt-6 md:pt-8 pb-12 px-4 sm:px-6 md:px-8">
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Toolbar glass */}
            {clients.length > 0 && (
              <div className="p-3 rounded-2xl bg-gradient-to-b from-white/75 to-white/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.06)]">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-[320px]">
                    <Input
                      value={search}
                      onChange={setSearch}
                      placeholder="Rechercher (nom, contact, email, @handle)"
                      icon={Search}
                    />
                  </div>
                  <span className="ml-auto text-[10.5px] text-gray-500 tabular-nums">
                    {filtered.length}/{clients.length} clients
                  </span>
                </div>
              </div>
            )}

            {/* Liste */}
            {clients.length === 0 ? (
              <div className="rounded-2xl bg-gradient-to-b from-white/65 to-white/40 backdrop-blur-[8px] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
                <EmptyState
                  icon={Building2}
                  title="Aucun client"
                  description="Créez le premier client pour commencer."
                  cta={{ label: "Nouveau client", onClick: () => setShowCreate(true) }}
                />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-[12px] text-gray-500 italic text-center py-8">
                Aucun client ne correspond à la recherche.
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filtered.map((client) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    onDelete={() => handleDelete(client.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal création */}
      <Modal open={showCreate} onClose={() => !saving && setShowCreate(false)} size="md">
        <Modal.Header onClose={() => !saving && setShowCreate(false)}>
          Nouveau client
        </Modal.Header>
        <form
          onSubmit={(e) => {
            void handleCreate(e);
          }}
          className="contents"
        >
          <Modal.Body>
            <p className="text-[12.5px] text-gray-500 mb-4">
              Renseignez les informations de contact (le nom est obligatoire).
            </p>
            <div className="grid grid-cols-2 gap-3">
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
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreate(false)}
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

// ─── ClientCard ────────────────────────────────────────────────────────────

function ClientCard({
  client,
  onDelete,
}: {
  client: ClientItem;
  onDelete: () => void;
}) {
  const initial = client.name.charAt(0).toUpperCase();

  return (
    <div className="group relative flex flex-col gap-4 p-5 rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[14px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_0_0_1px_rgba(15,23,42,0.06),inset_0_-1px_0_rgba(15,23,42,0.04),0_2px_8px_-2px_rgba(15,23,42,0.08)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.6),inset_0_0_0_1px_rgba(15,23,42,0.1),inset_0_-1px_0_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.08),0_16px_36px_-12px_rgba(15,23,42,0.18)] hover:-translate-y-0.5 transition-all">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-rose-200 to-peach-200 inline-flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),0_2px_4px_rgba(15,23,42,0.06)]">
          <span className="text-[18px] font-semibold text-gray-800">{initial}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-gray-950 truncate leading-tight">
            {client.name}
          </p>
          {client.contactName && (
            <p className="text-[12px] text-gray-500 mt-0.5 truncate">{client.contactName}</p>
          )}
        </div>
      </div>

      {/* Contact info */}
      {(client.email || client.phone) && (
        <div className="flex flex-wrap gap-3 text-[11.5px] text-gray-500">
          {client.email && (
            <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
              <Mail size={11} className="text-gray-400 shrink-0" />
              <span className="truncate">{client.email}</span>
            </span>
          )}
          {client.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone size={11} className="text-gray-400" />
              {client.phone}
            </span>
          )}
        </div>
      )}

      {/* Comptes IG */}
      {client.accounts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {client.accounts.slice(0, 4).map((a) => (
            <Chip key={a.id} variant="sky" size="sm">
              @{a.handle}
            </Chip>
          ))}
          {client.accounts.length > 4 && (
            <span className="text-[10.5px] text-gray-400 italic self-center">
              + {client.accounts.length - 4}
            </span>
          )}
        </div>
      ) : (
        <p className="text-[10.5px] uppercase tracking-widest font-medium text-gray-400 italic">
          Aucun compte Instagram
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-white/40 mt-auto">
        <Link
          href={`/admin/clients/${client.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-gray-700 hover:text-gray-950 bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_2px_6px_rgba(15,23,42,0.06)] transition-all"
        >
          Configurer
          <ArrowRight size={11} />
        </Link>
        <div className="ml-auto">
          <DeleteButton
            itemLabel={`le client "${client.name}"`}
            description="Le client sera définitivement supprimé."
            onConfirm={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
