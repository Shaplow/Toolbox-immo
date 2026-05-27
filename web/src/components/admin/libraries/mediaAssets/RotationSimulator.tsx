"use client";

/**
 * RotationSimulator — panel admin pour simuler la prochaine sélection d'asset
 * pour un compte IG donné, sans avancer le curseur.
 *
 * Utilise GET /api/admin/libraries/media/[id]/simulate-rotation?accountId=X
 * qui appelle `selectMediaAssetBySetSequence(..., readOnly: true)`.
 *
 * Replié par défaut pour ne pas alourdir le panel parent.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Play, RotateCw, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

interface InstagramAccount {
  id: string;
  handle: string;
  name?: string;
}

interface SimulationResult {
  asset:
    | {
        id: string;
        url: string;
        filename: string;
        setTag: string | null;
        category: string | null;
        lastUsedAtForAccount: string | null;
        usageCountForAccount: number;
        lastUsedAtGlobal: string | null;
        usageCountGlobal: number;
      }
    | null;
  rotationScope: "per_account" | "shared";
  cursor: { value: number; position: number; totalSlots: number } | null;
  reason: string;
}

interface Props {
  libraryId: string;
  accounts: InstagramAccount[];
}

export function RotationSimulator({ libraryId, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSimulate() {
    if (!accountId) {
      toast.error("Sélectionne un compte d'abord");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/libraries/media/${libraryId}/simulate-rotation?accountId=${encodeURIComponent(accountId)}`
      );
      const data = (await res.json()) as SimulationResult | { error?: string };
      if (!res.ok) {
        toast.error(("error" in data && data.error) || "Erreur lors de la simulation");
        return;
      }
      setResult(data as SimulationResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl bg-white mb-4">
      {/* Header pliable */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <RotateCw size={14} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-800">
            Simulateur de rotation
          </span>
          <span className="text-[10px] text-gray-400 italic">
            (lecture seule, n&apos;avance pas le curseur)
          </span>
        </div>
        {open ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 space-y-3">
          <div className="flex items-end gap-2 pt-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Compte Instagram
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                disabled={loading}
              >
                {accounts.length === 0 ? (
                  <option value="">— Aucun compte —</option>
                ) : (
                  accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.handle}
                      {a.name && a.name !== a.handle ? ` — ${a.name}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleSimulate()}
              disabled={!accountId || loading}
              icon={loading ? Loader2 : Play}
            >
              {loading ? "Simulation…" : "Simuler"}
            </Button>
          </div>

          {result && (
            <div className="space-y-3">
              {/* Méta contexte */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                  scope : {result.rotationScope === "shared" ? "partagé" : "par compte"}
                </span>
                {result.cursor && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                    curseur {result.cursor.value} · slot {result.cursor.position}/{result.cursor.totalSlots}
                  </span>
                )}
              </div>

              {result.asset ? (
                <div className="flex gap-3 items-start border border-gray-100 rounded-lg p-3 bg-gray-50">
                  {/* Preview */}
                  <div className="w-24 h-24 shrink-0 bg-black rounded-md overflow-hidden flex items-center justify-center">
                    <video
                      src={result.asset.url}
                      className="w-full h-full object-contain"
                      muted
                      preload="metadata"
                    />
                  </div>

                  {/* Détails */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {result.asset.filename}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {result.asset.setTag && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                          set: {result.asset.setTag}
                        </span>
                      )}
                      {result.asset.category && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          cat: {result.asset.category}
                        </span>
                      )}
                      <span className="text-gray-500">
                        usage compte : {result.asset.usageCountForAccount}×
                      </span>
                      <span className="text-gray-400">
                        · global : {result.asset.usageCountGlobal}×
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      <span className="font-medium text-gray-700">Raison : </span>
                      {result.reason}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Aucun asset sélectionné</p>
                    <p className="mt-0.5">{result.reason}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
