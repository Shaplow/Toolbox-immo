"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, ToggleLeft, ToggleRight, AlertCircle, Pencil, Check, X, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteButton } from "@/components/ui/DeleteButton";
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
      toast.error(d.error ?? "Erreur lors de la création");
      return;
    }
    const created = await res.json() as Offer;
    setOffers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setNewOfferName("");
    setAddingOffer(false);
    toast.success("Offre créée.");
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
    toast.success("Offre renommée.");
  }

  async function handleDeleteOffer(offer: Offer) {
    const res = await fetch(`/api/admin/offers/${offer.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      toast.error(d.error ?? "Erreur lors de la suppression");
      return;
    }
    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    setRules((prev) => prev.filter((r) => r.offre !== offer.name));
    toast.success("Offre supprimée.");
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
    const res = await fetch(`/api/admin/offer-schedule/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Règle supprimée.");
    } else {
      toast.error("Erreur lors de la suppression");
    }
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
            <FormField label="Heure">
              <Input
                type="time"
                value={form.publishTime}
                onChange={(v) => setForm((f) => ({ ...f, publishTime: v }))}
              />
            </FormField>
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
          <Button
            type="submit"
            variant="primary"
            icon={Plus}
            loading={creating}
            disabled={templates.length === 0 || offers.length === 0}
          >
            Ajouter
          </Button>
        </form>
        {formError && <p className="mt-2 text-xs text-red-600">{formError}</p>}
      </div>

      {/* Loading / error */}
      {loading && <p className="text-sm text-gray-400">Chargement…</p>}
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {/* Offer groups */}
      {!loading && (
        <div className="space-y-4">
          {allOfferNames.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title="Aucune règle de planification"
              description="Créez d'abord une offre, puis ajoutez des règles de publication pour chaque jour et heure."
            />
          )}
          {allOfferNames.map((offerName) => {
            const offer = offers.find((o) => o.name === offerName);
            const isEditing = editingOfferId === offer?.id;
            return (
              <div key={offerName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Offer header */}
                <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                  {isEditing && offer ? (
                    <>
                      <Input
                        autoFocus
                        value={editingOfferName}
                        onChange={setEditingOfferName}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); void handleRenameOffer(offer.id); }
                          if (e.key === "Escape") setEditingOfferId(null);
                        }}
                        className="text-sm font-semibold w-40 py-0.5"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Check}
                        onClick={() => { void handleRenameOffer(offer.id); }}
                        title="Valider"
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        <span className="sr-only">Valider</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={X}
                        onClick={() => setEditingOfferId(null)}
                        title="Annuler"
                      >
                        <span className="sr-only">Annuler</span>
                      </Button>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold text-gray-800 flex-1">{offerName}</h3>
                      <span className="text-xs text-gray-400 mr-2">{grouped[offerName]!.length} règle(s)</span>
                      {offer && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Pencil}
                            onClick={() => { setEditingOfferId(offer.id); setEditingOfferName(offer.name); setOfferError(null); }}
                            title="Renommer l'offre"
                          >
                            <span className="sr-only">Renommer</span>
                          </Button>
                          <DeleteButton
                            itemLabel={`l'offre « ${offer.name} »`}
                            description={
                              rules.filter((r) => r.offre === offer.name).length > 0
                                ? `Cette offre possède ${rules.filter((r) => r.offre === offer.name).length} règle(s) associée(s) qui seront également supprimées.`
                                : "Cette action est irréversible."
                            }
                            onConfirm={() => handleDeleteOffer(offer)}
                          />
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
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { void toggleActive(rule); }}
                              title={rule.isActive ? "Désactiver" : "Activer"}
                              className={rule.isActive ? "text-indigo-500 hover:text-indigo-700" : "text-gray-400 hover:text-indigo-600"}
                            >
                              {rule.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                              <span className="sr-only">{rule.isActive ? "Désactiver" : "Activer"}</span>
                            </Button>
                            <DeleteButton
                              itemLabel="cette règle"
                              onConfirm={() => handleDeleteRule(rule.id)}
                            />
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
              <div className="flex-1">
                <Input
                  autoFocus
                  required
                  value={newOfferName}
                  onChange={(v) => { setNewOfferName(v); setOfferError(null); }}
                  onKeyDown={(e) => { if (e.key === "Escape") { setAddingOffer(false); setNewOfferName(""); } }}
                  placeholder="Nom de l'offre (ex: PREMIUM)"
                />
              </div>
              <Button type="submit" variant="primary" size="sm" icon={Check}>
                Créer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={X}
                onClick={() => { setAddingOffer(false); setNewOfferName(""); setOfferError(null); }}
              >
                Annuler
              </Button>
            </form>
          ) : (
            <Button
              variant="ghost"
              icon={Plus}
              onClick={() => { setAddingOffer(true); setOfferError(null); }}
            >
              Ajouter une offre
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
