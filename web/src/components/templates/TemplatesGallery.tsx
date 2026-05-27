"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { EditTemplateInfoButton } from "@/components/templates/EditTemplateInfoButton";
import { TemplateAdminActions } from "@/components/templates/TemplateAdminActions";
import { Input } from "@/components/ui/Input";

export interface TemplateGalleryItem {
  id: string;
  name: string;
  client: string | null;
  formats: string[];
  updatedAt: string;
}

interface Props {
  templates: TemplateGalleryItem[];
  isAdmin: boolean;
}

type SortMode = "client" | "recent";

const SORT_BUTTON_BASE =
  "text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors";

export function TemplatesGallery({ templates, isAdmin }: Props) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("client");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.client ?? "").toLowerCase().includes(q),
    );
  }, [templates, search]);

  // Groupage : par client (par défaut) ou plat trié par updatedAt desc ("Récents").
  const groups = useMemo(() => {
    if (sortMode === "recent") {
      const sorted = [...filtered].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      return [{ key: "__recent__", label: "Récents", items: sorted }];
    }
    const map = new Map<string, TemplateGalleryItem[]>();
    for (const t of filtered) {
      const key = t.client?.trim() || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return a.localeCompare(b, "fr");
    });
    return keys.map((key) => ({
      key,
      label: key === "__none__" ? "Sans client" : key,
      items: map.get(key) ?? [],
    }));
  }, [filtered, sortMode]);

  const showGroupHeaders = sortMode === "client" && groups.length > 1;

  if (templates.length === 0) {
    return (
      <div className="text-center py-24 text-gray-400">
        <LayoutTemplate size={40} className="mx-auto mb-4 opacity-30" />
        <p className="font-medium">Aucun template pour l&apos;instant</p>
        <p className="text-sm mt-1">Créez votre premier template pour commencer</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="max-w-sm flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Rechercher par nom ou client…"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSortMode("client")}
            className={`${SORT_BUTTON_BASE} ${
              sortMode === "client"
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            Par client
          </button>
          <button
            type="button"
            onClick={() => setSortMode("recent")}
            className={`${SORT_BUTTON_BASE} ${
              sortMode === "recent"
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            Récents
          </button>
        </div>
        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} template{filtered.length !== 1 ? "s" : ""}
          {search && filtered.length !== templates.length && ` sur ${templates.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Aucun template ne correspond à votre recherche.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => (
            <section key={group.key}>
              {showGroupHeaders && (
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    {group.label}
                  </h2>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {group.items.length}
                  </span>
                  <div className="flex-1 border-t border-gray-100" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.items.map((template) => (
                  <div
                    key={template.id}
                    className="bg-white border border-gray-100 rounded-xl transition-colors hover:border-gray-200 group"
                  >
                    <div className="p-4">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
                        {isAdmin && (
                          <EditTemplateInfoButton
                            id={template.id}
                            initialName={template.name}
                            initialClient={template.client ?? ""}
                          />
                        )}
                      </div>
                      {!showGroupHeaders && template.client && (
                        <p className="text-xs text-indigo-700 mt-0.5">{template.client}</p>
                      )}
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {template.formats.map((format) => (
                          <span
                            key={format}
                            className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                          >
                            {format}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mt-3">
                        {new Date(template.updatedAt).toLocaleDateString("fr-FR")}
                      </p>
                    </div>

                    <div className="px-4 pb-4">
                      <div className="flex gap-2">
                        {isAdmin && (
                          <Link
                            href={`/templates/${template.id}/edit`}
                            className="flex-1 text-center text-xs border border-gray-200 text-gray-700 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Éditer
                          </Link>
                        )}
                        <Link
                          href={`/generate/${template.id}`}
                          className="flex-1 text-center text-xs bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          Générer
                        </Link>
                        {isAdmin && <TemplateAdminActions id={template.id} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
