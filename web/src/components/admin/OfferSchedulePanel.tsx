"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle, Pencil, Check, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { DAY_LABELS, type OfferScheduleRule } from "@/types/calendar";

interface TemplateOption {
  id: string;
  name: string;
  contentType: string;
}

interface Offer {
  id: string;
  name: string;
}

export function OfferSchedulePanel() {
  const [rules, setRules] = useState<OfferScheduleRule[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Offer management
  const [newOfferName, setNewOfferName] = useState("");
  const [addingOffer, setAddingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [editingOfferName, setEditingOfferName] = useState("");

  // Rule creation form
  const [form, setForm] = useState({
    offre: "",
    dayOfWeek: 1,
    publishTime: "19:00",
    templateId: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rulesRes, templatesRes, offersRes] = await Promise.all([
        fetch("/api/admin/offer-schedule"),
        fetch("/api/templates"),
        fetch("/api/admin/offers"),
      ]);
      if (!rulesRes.ok) throw new Error(`Erreur chargement règles ${rulesRes.status}`);
      if (!templatesRes.ok) throw new Error(`Erreur chargement templates ${templatesRes.status}`);
      if (!offersRes.ok) throw new Error(`Erreur chargement offres ${offersRes.status}`);
      const rulesData = await rulesRes.json() as OfferScheduleRule[];
      const templatesData = await templatesRes.json() as TemplateOption[];
      const offersData = await offersRes.json() as Offer[];
      setRules(rulesData);
      setOffers(offersData);
      const withType = templatesData.filter((t) => t.contentType);
      setTemplates(withType);
      if (withType.length > 0) {
        setForm((f) => ({ ...f, templateId: f.templateId || withType[0]!.id }));
      }
      if (offersData.length > 0) {
        setForm((f) => (f.offre ? f : { ...f, offre: offersData[0]!.name }));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);  

  useEffect(() => { void load(); }, [load]);

  // ── Offer CRUD ─────────────────────────────────────────────────────────────

  async function handleAddOffer(e: React.FormEvent) {
    e.preventDefault();
    setOfferError(null);
    const res = await fetch("/api/admin/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newOfferName }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setOfferError(d.error ?? "Erreur");
      return;
    }
    const created = await res.json() as Offer;
    setOffers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setNewOfferName("");
    setAddingOffer(false);
  }

  async function handleRenameOffer(id: string) {
    setOfferError(null);
    const res = await fetch(`/api/admin/offers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingOfferName }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setOfferError(d.error ?? "Erreur");
      return;
    }
    const updated = await res.json() as Offer;
    setOffers((prev) => prev.map((o) => (o.id === id ? updated : o)));
    // Also update rules that reference the old name
    setRules((prev) => prev.map((r) => {
      const old = offers.find((o) => o.id === id);
      return old && r.offre === old.name ? { ...r, offre: updated.name } : r;
    }));
    setEditingOfferId(null);
  }

  async function handleDeleteOffer(offer: Offer) {
    const rulesForOffer = rules.filter((r) => r.offre === offer.name);
    const msg = rulesForOffer.length > 0
      ? `Supprimer l'offre « ${offer.name} » et ses ${rulesForOffer.length} règle(s) associées ?`
      : `Supprimer l'offre « ${offer.name} » ?`;
    if (!confirm(msg)) return;
    const res = await fetch(`/api/admin/offers/${offer.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    setRules((prev) => prev.filter((r) => r.offre !== offer.name));
  }

  // ── Rule CRUD ───────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.templateId) { setFormError("Sélectionnez un template"); return; }
    setCreating(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/offer-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offre: form.offre,
          dayOfWeek: form.dayOfWeek,
          publishTime: form.publishTime,
          templateId: form.templateId,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la création");
      }
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(rule: OfferScheduleRule) {
    const res = await fetch(`/api/admin/offer-schedule/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    if (res.ok) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: !r.isActive } : r)));
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm("Supprimer cette règle ?")) return;
    const res = await fetch(`/api/admin/offer-schedule/${id}`, { method: "DELETE" });
    if (res.ok) setRules((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const offerNames = offers.map((o) => o.name);
  const grouped: Record<string, OfferScheduleRule[]> = {};
  offerNames.forEach((name) => { grouped[name] = rules.filter((r) => r.offre === name); });
  // Orphaned rules (offer deleted but rules still in DB)
  const knownNames = new Set(offerNames);
  [...new Set(rules.map((r) => r.offre).filter((o) => !knownNames.has(o)))].forEach((name) => {
    grouped[name] = rules.filter((r) => r.offre === name);
  });
  const allOfferNames = [...offerNames, ...Object.keys(grouped).filter((k) => !knownNames.has(k))];

  const templatesByType = templates.reduce<Record<string, TemplateOption[]>>((acc, t) => {
    (acc[t.contentType] ??= []).push(t);
    return acc;
  }, {});
  const selectedTemplate = templates.find((t) => t.id === form.templateId);

  return (
    <div className="space-y-8">
      {/* Warning if no templates have contentType */}
      {!loading && templates.length === 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Aucun template configuré avec un type de contenu.</p>
            <p className="text-xs mt-0.5 text-amber-600">
              Éditez vos templates et définissez leur type via l&apos;API (<code>contentType</code>) pour pouvoir créer des règles.
            </p>
          </div>
        </div>
      )}

      {/* Rule creation form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Ajouter une règle</h2>
        <form onSubmit={(e) => { void handleCreate(e); }} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Offre</label>
            <select
              value={form.offre}
              onChange={(e) => setForm((f) => ({ ...f, offre: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {offerNames.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Jour</label>
            <select
              value={form.dayOfWeek}
              onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {DAY_LABELS.map((d, i) => <option key={i} value={i + 1}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Heure</label>
            <input
              type="time"
              value={form.publishTime}
              onChange={(e) => setForm((f) => ({ ...f, publishTime: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Template</label>
            <div className="flex items-center gap-2">
              <select
                value={form.templateId}
                onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))}
                disabled={templates.length === 0}
                className="border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 max-w-xs"
              >
                {templates.length === 0 && <option value="">— aucun template disponible —</option>}
                {Object.entries(templatesByType).map(([type, group]) => (
                  <optgroup key={type} label={type}>
                    {group.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
              {selectedTemplate && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">
                  {selectedTemplate.contentType}
                </span>
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || templates.length === 0 || offers.length === 0}
            className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2"
          >
            <Plus size={14} /> {creating ? "Création…" : "Ajouter"}
          </button>
        </form>
        {formError && <p className="mt-2 text-xs text-red-600">{formError}</p>}
      </div>

      {/* Loading / error */}
      {loading && <p className="text-sm text-gray-400">Chargement…</p>}
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {/* Offer groups */}
      {!loading && (
        <div className="space-y-4">
          {allOfferNames.map((offerName) => {
            const offer = offers.find((o) => o.name === offerName);
            const isEditing = editingOfferId === offer?.id;
            return (
              <div key={offerName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Offer header */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                  {isEditing && offer ? (
                    <>
                      <input
                        autoFocus
                        value={editingOfferName}
                        onChange={(e) => setEditingOfferName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); void handleRenameOffer(offer.id); }
                          if (e.key === "Escape") setEditingOfferId(null);
                        }}
                        className="text-sm font-semibold border border-indigo-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 w-40"
                      />
                      <button type="button" onClick={() => { void handleRenameOffer(offer.id); }} className="text-indigo-600 hover:text-indigo-800" title="Valider">
                        <Check size={14} />
                      </button>
                      <button type="button" onClick={() => setEditingOfferId(null)} className="text-gray-400 hover:text-gray-600" title="Annuler">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold text-gray-800 flex-1">{offerName}</h3>
                      <span className="text-xs text-gray-400 mr-2">{grouped[offerName]!.length} règle(s)</span>
                      {offer && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditingOfferId(offer.id); setEditingOfferName(offer.name); setOfferError(null); }}
                            className="rounded p-1 text-gray-400 hover:text-indigo-600"
                            title="Renommer l'offre"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { void handleDeleteOffer(offer); }}
                            className="rounded p-1 text-gray-400 hover:text-red-500"
                            title="Supprimer l'offre"
                          >
                            <X size={13} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {offerError && editingOfferId === offer?.id && (
                  <p className="px-5 py-1 text-xs text-red-600 bg-red-50">{offerError}</p>
                )}
                {/* Rules */}
                {grouped[offerName]!.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-gray-400 italic">Aucune règle configurée.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {grouped[offerName]!
                      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.publishTime.localeCompare(b.publishTime))
                      .map((rule) => (
                        <div key={rule.id} className={`flex items-center gap-4 px-5 py-3 ${!rule.isActive ? "opacity-40" : ""}`}>
                          <span className="w-10 text-sm font-medium text-gray-700">{DAY_LABELS[rule.dayOfWeek - 1]}</span>
                          <span className="w-14 text-sm text-gray-600 tabular-nums">{rule.publishTime}</span>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700">{rule.contentType}</span>
                          <span className="text-xs text-gray-500 truncate max-w-xs">
                            {rule.template?.name ?? <span className="italic text-gray-400">sans template</span>}
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => { void toggleActive(rule); }}
                              className={`text-${rule.isActive ? "indigo" : "gray"}-400 hover:text-indigo-600`}
                              title={rule.isActive ? "Désactiver" : "Activer"}
                            >
                              {rule.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleDeleteRule(rule.id); }}
                              className="text-gray-400 hover:text-red-500"
                              title="Supprimer la règle"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add offer */}
          {addingOffer ? (
            <form
              onSubmit={(e) => { void handleAddOffer(e); }}
              className="flex items-center gap-2 bg-white rounded-xl border border-indigo-200 px-5 py-3"
            >
              <input
                autoFocus
                required
                value={newOfferName}
                onChange={(e) => { setNewOfferName(e.target.value); setOfferError(null); }}
                onKeyDown={(e) => { if (e.key === "Escape") { setAddingOffer(false); setNewOfferName(""); } }}
                placeholder="Nom de l'offre (ex: PREMIUM)"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 flex items-center gap-1">
                <Check size={14} /> Créer
              </button>
              <button type="button" onClick={() => { setAddingOffer(false); setNewOfferName(""); setOfferError(null); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">
                <X size={14} />
              </button>
              {offerError && <span className="text-xs text-red-600">{offerError}</span>}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setAddingOffer(true); setOfferError(null); }}
              className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium py-1"
            >
              <Plus size={15} /> Ajouter une offre
            </button>
          )}
        </div>
      )}
    </div>
  );
}
