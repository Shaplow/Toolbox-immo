"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, ChevronLeft, Check } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

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

export default function AdminClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const clientId = params?.id ?? "";

  const [client, setClient] = useState<Client | null>(null);
  const [allAccounts, setAllAccounts] = useState<AccountStub[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", contactName: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [togglingAccountId, setTogglingAccountId] = useState<string | null>(null);

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

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchData(); }, [fetchData]);

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

      <div className="space-y-6">
        {/* Informations client */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Informations</p>
          <form onSubmit={handleSave} className="space-y-3">
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

        {/* Comptes Instagram */}
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
    </div>
  );
}
