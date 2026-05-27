"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Building2, ChevronLeft, Check, Plus, Instagram } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { InstagramAccountRow, type InstagramAccountData } from "@/components/admin/InstagramAccountRow";

export type ClientDetailAccountStub = {
  id: string;
  name: string;
  handle: string;
  clientId: string | null;
  client?: { id: string; name: string } | null;
};

export type ClientDetailData = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  accounts: { id: string; name: string; handle: string }[];
};

type Tab = "info" | "accounts";

interface Props {
  clientId: string;
  initialClient: ClientDetailData;
  initialAccounts: ClientDetailAccountStub[];
}

export function ClientDetailClient({ clientId, initialClient, initialAccounts }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // B3 — Lit ?tab=accounts depuis l'URL (utilisé par les liens depuis
  // /admin/accounts vers la fiche client onglet comptes). Valeurs invalides
  // tombent sur "info" par défaut.
  const initialTab: Tab = searchParams?.get("tab") === "accounts" ? "accounts" : "info";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [client, setClient] = useState<ClientDetailData | null>(initialClient);
  const [allAccounts, setAllAccounts] = useState<ClientDetailAccountStub[]>(initialAccounts);
  const [form, setForm] = useState({
    name: initialClient.name,
    contactName: initialClient.contactName ?? "",
    email: initialClient.email ?? "",
    phone: initialClient.phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);

  // Onglet Comptes Instagram
  const [igAccounts, setIgAccounts] = useState<InstagramAccountData[]>([]);
  const [igLoading, setIgLoading] = useState(false);
  const [igError, setIgError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", handle: "" });
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);

  // Search dans le picker de comptes (onglet Infos)
  const [accountSearch, setAccountSearch] = useState("");

  const filteredPickerAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return allAccounts;
    return allAccounts.filter(
      (a) =>
        a.handle.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q),
    );
  }, [allAccounts, accountSearch]);

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

    const clientData = await clientRes.json() as ClientDetailData;
    setClient(clientData);
    setForm({
      name: clientData.name,
      contactName: clientData.contactName ?? "",
      email: clientData.email ?? "",
      phone: clientData.phone ?? "",
    });

    if (accountsRes.ok) {
      setAllAccounts(await accountsRes.json() as ClientDetailAccountStub[]);
    }
  }, [clientId, router]);

  // Chargement des comptes Instagram liés à ce client
  const fetchIgAccounts = useCallback(async () => {
    setIgLoading(true);
    setIgError(null);
    try {
      const accountsRes = await fetch(`/api/admin/accounts?clientId=${clientId}`);
      if (!accountsRes.ok) throw new Error(`Erreur serveur (HTTP ${accountsRes.status})`);
      setIgAccounts(await accountsRes.json() as InstagramAccountData[]);
    } catch (err) {
      setIgError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setIgLoading(false);
    }
  }, [clientId]);

  // Pas de fetchData initial : les données sont fournies par le server
  // component via initialClient / initialAccounts. fetchData reste utilisé
  // pour rafraîchir après une mutation (handleSave, handleAccountToggle).

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

  async function handleAccountToggle(account: ClientDetailAccountStub) {
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
    setAddForm({ name: "", handle: "" });
    void fetchIgAccounts();
    // Mettre à jour la liste globale pour le picker de l'onglet Infos
    void fetchData();
  }

  // Loading state n'est plus initial (initialData injecté par RSC) — peut
  // arriver pendant un refetch ; on garde l'UI principale visible et on
  // affichera un spinner local près du form de save si besoin.
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
                <FormField label="Nom" required error={saveError || undefined}>
                  <Input
                    type="text"
                    required
                    value={form.name}
                    onChange={(v) => { setForm({ ...form, name: v }); setSaveOk(false); }}
                  />
                </FormField>
                <FormField label="Contact" help="Optionnel">
                  <Input
                    type="text"
                    value={form.contactName}
                    onChange={(v) => { setForm({ ...form, contactName: v }); setSaveOk(false); }}
                    placeholder="Jean Martin"
                  />
                </FormField>
                <FormField label="Email" help="Optionnel">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(v) => { setForm({ ...form, email: v }); setSaveOk(false); }}
                    placeholder="jean@agence.fr"
                  />
                </FormField>
                <FormField label="Téléphone" help="Optionnel">
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(v) => { setForm({ ...form, phone: v }); setSaveOk(false); }}
                    placeholder="06 00 00 00 00"
                  />
                </FormField>
              </div>
              <div className="flex items-center justify-end gap-3">
                {saveOk && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <Check size={12} /> Enregistré
                  </span>
                )}
                <Button type="submit" variant="primary" loading={saving}>
                  Enregistrer
                </Button>
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
              <>
                {allAccounts.length > 10 && (
                  <div className="mb-3 max-w-xs">
                    <Input
                      value={accountSearch}
                      onChange={setAccountSearch}
                      placeholder="Rechercher un compte…"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  {filteredPickerAccounts.length === 0 ? (
                    <p className="text-xs text-gray-400 italic py-2">
                      Aucun compte ne correspond à votre recherche.
                    </p>
                  ) : (
                    filteredPickerAccounts.map((account) => {
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
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Onglet : Comptes Instagram */}
      {activeTab === "accounts" && (
        <div className="space-y-4">
          {/* Header onglet */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-500">
                Comptes Instagram configurés pour ce client.
              </p>
              <Link href="/admin/accounts" className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors">
                → Voir tous les comptes Instagram
              </Link>
            </div>
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
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nom" required>
                  <Input
                    type="text"
                    required
                    value={addForm.name}
                    onChange={(v) => setAddForm((f) => ({ ...f, name: v }))}
                    placeholder="Marc"
                  />
                </FormField>
                <FormField label="Handle Instagram" required>
                  <Input
                    type="text"
                    required
                    value={addForm.handle}
                    onChange={(v) => setAddForm((f) => ({ ...f, handle: v }))}
                    placeholder="@marc_immo"
                  />
                </FormField>
              </div>
              {addFormError && <p className="text-xs text-red-500">{addFormError}</p>}
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setShowAddForm(false); setAddFormError(null); }}
                >
                  Annuler
                </Button>
                <Button type="submit" variant="primary" loading={addingAccount}>
                  Créer
                </Button>
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
