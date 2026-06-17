import Link from "next/link";
import { LayoutTemplate, ShieldAlert, ArrowRight, Wrench } from "lucide-react";
import { TOOL_LABELS, TOOL_DESCRIPTIONS, type Tool } from "@/lib/permissions";
import { TOOL_META } from "@/lib/toolMeta";

// parsePermissions inliné — évite de pull userContext.ts (qui importe
// next/headers et casse le bundle client).
function parsePermissions(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]") as string[];
  } catch {
    return [];
  }
}

export interface HomeExternalClientAccess {
  templates: Array<{
    id: string;
    name: string;
    previewUrl: string | null;
    previewVideoUrl: string | null;
  }>;
}

interface HomeExternalClientProps {
  permissions: string;
  access: HomeExternalClientAccess;
}

/**
 * HomeExternalClient — gateway client externe flat shadcn.
 *
 * Affiche templates assignés + outils granulaires.
 * Out of scope : pipeline éditoriale.
 */
export function HomeExternalClient({ permissions, access }: HomeExternalClientProps) {
  const userPerms = parsePermissions(permissions) as Tool[];
  const knownTools = userPerms.filter((p): p is Tool => p in TOOL_LABELS);
  const otherTools = knownTools.filter((t) => t !== "templates");
  const hasOtherTools = otherTools.length > 0;
  const hasTemplates = access.templates.length > 0;
  const hasAnyAccess = hasOtherTools || hasTemplates;

  if (!hasAnyAccess) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-md px-6 py-16 flex flex-col items-center text-center gap-5">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-warning-50 border border-warning-200">
            <ShieldAlert size={20} className="text-warning-700" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-foreground mb-2">
              Aucun accès actif
            </h1>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              Aucun template attribué. Contactez votre administrateur.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Bienvenue
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Vos templates et générations.
            </p>
          </div>
          <Link
            href="/listings"
            className="inline-flex items-center gap-2 px-3 h-9 rounded-md bg-card border border-border text-foreground hover:bg-muted text-[13px] font-medium transition-colors focus-ring"
          >
            Mes générations
            <ArrowRight size={13} />
          </Link>
        </header>

        {hasTemplates && (
          <section className="rounded-lg bg-card border border-border p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <p className="text-[13px] font-semibold tracking-tight text-foreground">
                Templates accessibles
                <span className="ml-2 text-[11px] font-normal text-muted-foreground tabular-nums">
                  {access.templates.length}
                </span>
              </p>
              <LayoutTemplate size={16} className="text-muted-foreground" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {access.templates.map((t) => {
                const hasPreview = !!t.previewUrl || !!t.previewVideoUrl;
                return (
                  <Link
                    key={t.id}
                    href={`/generate/${t.id}`}
                    className="group flex items-stretch gap-3 p-2 pr-4 rounded-md bg-card border border-border hover:bg-muted hover:border-zinc-300 transition-colors focus-ring"
                  >
                    <div className="shrink-0 w-[68px] h-[68px] rounded-md bg-muted border border-border overflow-hidden flex items-center justify-center">
                      {t.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.previewUrl}
                          alt=""
                          loading="lazy"
                          className="max-w-full max-h-full w-auto h-auto object-contain"
                        />
                      ) : t.previewVideoUrl ? (
                        <video
                          src={t.previewVideoUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="max-w-full max-h-full w-auto h-auto object-contain"
                        />
                      ) : (
                        <LayoutTemplate size={20} className="text-muted-foreground" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-foreground truncate">
                          {t.name}
                        </span>
                        <span className="block text-[10.5px] text-muted-foreground mt-0.5">
                          {hasPreview ? "Dernière génération" : "Pas encore généré"}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
                        Générer
                        <ArrowRight size={12} />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {hasOtherTools && (
          <section className="rounded-lg bg-card border border-border p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <p className="text-[13px] font-semibold tracking-tight text-foreground">
                Mes outils
                <span className="ml-2 text-[11px] font-normal text-muted-foreground tabular-nums">
                  {otherTools.length}
                </span>
              </p>
              <Wrench size={16} className="text-muted-foreground" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {otherTools.map((tool) => {
                const meta = TOOL_META[tool];
                return (
                  <Link
                    key={tool}
                    href={meta.href}
                    className="group flex items-start gap-3 px-4 py-3 rounded-md bg-card border border-border hover:bg-muted hover:border-zinc-300 transition-colors focus-ring"
                  >
                    <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
                      <meta.Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {TOOL_LABELS[tool]}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {TOOL_DESCRIPTIONS[tool]}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
