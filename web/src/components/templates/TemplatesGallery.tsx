"use client";

/**
 * TemplatesGallery — grid des templates Studio (refonte MID Liquid Glass).
 *
 * Toolbar glass (search + sort chips) + grid cards glass franc (groupage par
 * client ou récents). Card affichage : nom + client + formats chips + dates +
 * actions Éditer/Générer.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutTemplate, Search, Edit, Wand2 } from "lucide-react";
import { EditTemplateInfoButton } from "@/components/templates/EditTemplateInfoButton";
import { TemplateAdminActions } from "@/components/templates/TemplateAdminActions";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";

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
      <div className="rounded-2xl bg-card border border-border py-16  text-center text-muted-foreground">
        <LayoutTemplate size={36} className="mx-auto mb-4 opacity-30" />
        <p className="text-[14px] font-semibold text-foreground">
          Aucun template pour l&apos;instant
        </p>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Créez votre premier template pour commencer
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar glass */}
      <div className="p-3 rounded-2xl bg-card border border-border ">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-[300px]">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Rechercher (nom, client)"
              icon={Search}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Chip
              variant={sortMode === "client" ? "sky" : "default"}
              selected={sortMode === "client"}
              onClick={() => setSortMode("client")}
            >
              Par client
            </Chip>
            <Chip
              variant={sortMode === "recent" ? "sky" : "default"}
              selected={sortMode === "recent"}
              onClick={() => setSortMode("recent")}
            >
              Récents
            </Chip>
          </div>
          <span className="ml-auto text-[10.5px] text-muted-foreground tabular-nums">
            {filtered.length}/{templates.length} templates
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic text-center py-12">
          Aucun template ne correspond à la recherche.
        </p>
      ) : (
        <div className="space-y-10">
          {groups.map((group) => (
            <section key={group.key}>
              {showGroupHeaders && (
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
                    {group.label}
                  </p>
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-medium tabular-nums bg-white/70 text-foreground ">
                    {group.items.length}
                  </span>
                  <div className="flex-1 border-t border-white/40" />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.items.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isAdmin={isAdmin}
                    showClient={!showGroupHeaders}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TemplateCard ────────────────────────────────────────────────────────

function TemplateCard({
  template,
  isAdmin,
  showClient,
}: {
  template: TemplateGalleryItem;
  isAdmin: boolean;
  showClient: boolean;
}) {
  return (
    <div className="group relative flex flex-col gap-3 p-4 rounded-2xl bg-card border border-border  hover: hover:-translate-y-0.5 transition-all [&:has([data-menu-open=true])]:z-50">
      {/* Header */}
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground truncate leading-tight">
            {template.name}
          </p>
          {showClient && template.client && (
            <p className="text-[10.5px] uppercase tracking-widest font-medium text-gray-400 mt-1">
              {template.client}
            </p>
          )}
        </div>
        {isAdmin && (
          <EditTemplateInfoButton
            id={template.id}
            initialName={template.name}
            initialClient={template.client ?? ""}
          />
        )}
      </div>

      {/* Formats */}
      {template.formats.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.formats.map((format) => (
            <Chip key={format} variant="default" size="sm">
              {format}
            </Chip>
          ))}
        </div>
      )}

      {/* Date — timeZone forcée pour éviter hydration mismatch (server UTC vs client locale). */}
      <p className="text-[10.5px] text-muted-foreground font-mono tabular-nums mt-auto">
        Mis à jour{" "}
        {new Date(template.updatedAt).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Europe/Paris",
        })}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-3 border-t border-white/40">
        {isAdmin && (
          <Link
            href={`/templates/${template.id}/edit`}
            className="inline-flex items-center justify-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium text-foreground hover:text-foreground bg-card border border-border  hover: transition-all"
          >
            <Edit size={11} />
            Éditer
          </Link>
        )}
        <Link
          href={`/generate/${template.id}`}
          className="inline-flex items-center justify-center gap-1.5 flex-1 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium text-white bg-gradient-to-b from-gray-700 to-gray-900  hover:from-gray-600 hover:to-gray-800 hover: transition-all"
        >
          <Wand2 size={11} />
          Générer
        </Link>
        {isAdmin && <TemplateAdminActions id={template.id} />}
      </div>
    </div>
  );
}
