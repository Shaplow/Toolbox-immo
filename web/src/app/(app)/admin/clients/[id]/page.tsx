"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, ChevronLeft, Check, Plus, Instagram } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { InstagramAccountRow, type InstagramAccountData } from "@/components/admin/InstagramAccountRow";

type AccountStub = {
  id: string;
  name: string;
  handle: string;
  clientId: string | null;
  client?: { id: string; name: string } | null;
};

type Client = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accounts: { id: string; name: string; handle: string }[];
};

interface Offer {
  id: string;
  name: string;
}

type Tab = "info" | "accounts";

export default function AdminClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const clientId = params?.id ?? "";

  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [client, setClient] = useState<Client | null>(null);
  const [allAccounts, setAllAccounts] = useState<AccountStub[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", contactName: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);

  // Onglet Comptes Instagram
  const [igAccounts, setIgAccounts] = useState<InstagramAccountData[]>([]);
  const [igLoading, setIgLoading] = useState(false);
  const [igError, setIgError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", handle: "", offre: "" });
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  // Chargement de base (client + tous comptes pour le picker)
  const fetchData = useCallback(async () => {
    const [clientRes, accountsRes] = await Promise.all([
      fetch(`/api/admin/clients/${clientId}`),
      fetch("/api/admin/accounts"),
    ]);

    if (!clientRes.ok) {
      router.push("/admin/clients");
      return;
    }

    const clientData = await clientRes.json() as Client;
    setClient(clientData);
    setForm({
      name: clientData.name,
      contactName: clientData.contactName ?? "",
      email: clientData.email ?? "",
      phone: clientData.phone ?? "",
    });

    if (accountsRes.ok) {
      setAllAccounts(await accountsRes.json() as AccountStub[]);
    }

    setLoading(false);
  }, [clientId, router]);

  // Chargement des comptes Instagram liés à ce client
  const fetchIgAccounts = useCallback(async () => {
    setIgLoading(true);
    setIgError(null);
    try {
      const [accountsRes, offersRes] = await Promise.all([
        fetch(`/api/admin/accounts?clientId=${clientId}`),
        fetch("/api/admin/offers"),
      ]);
      if (!accountsRes.ok) throw new Error(`Erreur serveur (HTTP ${accountsRes.status})`);
      if (!offersRes.ok) throw new Error(`Erreur chargement offres (HTTP ${offersRes.status})`);
      const offersData = await offersRes.json() as Offer[];
      setIgAccounts(await accountsRes.json() as InstagramAccountData[]);
      setOffers(offersData);
      setAddForm((f) => (f.offre ? f : { ...f, offre: offersData[0]?.name ?? "" }));
    } catch (err) {
      setIgError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setIgLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Charger les comptes IG quand on active l'onglet
  useEffect(() => {
    if (activeTab === "accounts") {
      void fetchIgAccounts();
    }
  }, [activeTab, fetchIgAccounts]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    setSaveOk(false);
    setSaving(true);
    const res = await fetch(`/api/admin/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        contactName: form.contactName || null,
        email: form.email || null,
        phone: form.phone || null,
      }),
    });
    const data = await res.json() as { error?: string; name?: string };
    setSaving(false);
    if (data.error) { setSaveError(data.error); return; }
    setSaveOk(true);
    await fetchData();
  }

  async function handleAccountToggle(account: AccountStub) {
    const isCurrentlyAttached = account.clientId === clientId;
    setTogglingAccountId(account.id);
    await fetch(`/api/admin/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: isCurrentlyAttached ? null : clientId }),
    });
    setTogglingAccountId(null);
    await fetchData();
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setAddFormError(null);
    setAddingAccount(true);
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name.trim(),
        handle: addForm.handle.trim(),
        offre: addForm.offre,
        clientId,
      }),
    });
    setAddingAccount(false);
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setAddFormError(d.error ?? "Erreur lors de la création");
      return;
    }
    toast.success("Compte Instagram créé");
    setShowAddForm(false);
    setAddForm({ name: "", handle: "", offre: offers[0]?.name ?? "" });
    void fetchIgAccounts();
    // Mettre à jour la liste globale pour le picker de l'onglet Infos
    void fetchData();
  }

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-center h-48 text-gray-400">
          <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-3" />
          Chargement...
        </div>
      </div>
    );
  }

  if (!client) return null;

  const attachedIds = new Set(client.accounts.map((a) => a.id));

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
          <Building2 size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href="/admin/clients" className="text-xs text-gray-400 hover:text-indigo-700 flex items-center gap-1 transition-colors">
              <ChevronLeft size={12} /> Clients
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 truncate">{client.name}</h1>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("info")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "info"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Infos client
        </button>
        <button
          onClick={() => setActiveTab("accounts")}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === "accounts"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Instagram size={14} />
          Comptes Instagram
          {client.accounts.length > 0 && (
            <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-semibold">
              {client.accounts.length}
            </span>
          )}
        </button>
      </div>

      {/* Onglet : Infos client */}
      {activeTab === "info" && (
        <div className="space-y-6">
          {/* Informations client */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Informations</p>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Nom <span className="text-red-400">*</span></span>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => { setForm({ ...form, name: e.target.value }); setSaveOk(false); }}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Contact</span>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => { setForm({ ...form, contactName: e.target.value }); setSaveOk(false); }}
                    placeholder="Jean Martin"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => { setForm({ ...form, email: e.target.value }); setSaveOk(false); }}
                    placeholder="jean@agence.fr"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Téléphone</span>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => { setForm({ ...form, phone: e.target.value }); setSaveOk(false); }}
                    placeholder="06 00 00 00 00"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </label>
              </div>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <div className="flex items-center justify-end gap-3">
                {saveOk && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <Check size={12} /> Enregistré
                  </span>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60 transition-colors"
                >
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>

          {/* Comptes Instagram rattachés (picker) */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Comptes Instagram rattachés
            </p>
            {allAccounts.length === 0 ? (
              <p className="text-xs text-gray-400">Aucun compte Instagram créé.</p>
            ) : (
              <div className="space-y-2">
                {allAccounts.map((account) => {
                  const isAttached = attachedIds.has(account.id);
                  const isOtherClient = account.clientId !== null && account.clientId !== clientId;
                  const toggling = togglingAccountId === account.id;

                  return (
                    <label
                      key={account.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isAttached
                          ? "bg-indigo-50 border-indigo-200"
                          : "bg-white border-gray-100 hover:border-gray-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isAttached}
                        disabled={toggling}
                        onChange={() => void handleAccountToggle(account)}
                        className="accent-indigo-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${isAttached ? "text-indigo-800" : "text-gray-700"}`}>
                          {account.name}
                        </p>
                        <p className="text-[11px] text-gray-400">@{account.handle}</p>
                      </div>
                      {isOtherClient && (
                        <span className="text-[11px] text-gray-400 italic shrink-0">
                          rattaché à {account.client?.name ?? "un autre client"}
                        </span>
                      )}
                      {toggling && (
                        <div className="w-3 h-3 border border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Onglet : Comptes Instagram */}
      {activeTab === "accounts" && (
        <div className="space-y-4">
          {/* Header onglet */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Comptes Instagram configurés pour ce client.
            </p>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Ajouter un compte Instagram
            </button>
          </div>

          {/* Formulaire ajout */}
          {showAddForm && (
            <form
              onSubmit={(e) => void handleAddAccount(e)}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
            >
              <h3 className="text-sm font-semibold">Nouveau compte Instagram</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Nom</label>
                  <input
                    required
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Marc"
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Handle Instagram</label>
                  <input
                    required
                    value={addForm.handle}
                    onChange={(e) => setAddForm((f) => ({ ...f, handle: e.target.value }))}
                    placeholder="@marc_immo"
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Offre</label>
                  <select
                    value={addForm.offre}
                    onChange={(e) => setAddForm((f) => ({ ...f, offre: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  >
                    {offers.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              {addFormError && <p className="text-xs text-red-500">{addFormError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addingAccount}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {addingAccount ? "Création..." : "Créer"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddForm(false); setAddFormError(null); }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* Liste des comptes */}
          {igLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2" />
              Chargement...
            </div>
          ) : igError ? (
            <p className="text-sm text-red-500">{igError}</p>
          ) : igAccounts.length === 0 ? (
            <EmptyState
              icon={Instagram}
              title="Aucun compte rattaché"
              description="Ajoutez-en un pour démarrer la configuration de publication."
              cta={{
                label: "Ajouter un compte",
                onClick: () => setShowAddForm(true),
              }}
            />
          ) : (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {igAccounts.map((account) => (
                <InstagramAccountRow
                  key={account.id}
                  account={account}
                  offers={offers}
                  onUpdated={() => {
                    void fetchIgAccounts();
                    void fetchData();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
