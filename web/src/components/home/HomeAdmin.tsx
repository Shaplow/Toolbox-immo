import Link from "next/link";
import { CalendarDays, AlertTriangle, FileQuestion, UserX, ArrowRight, CalendarClock, Building2, Film, Video } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { SlotStatus } from "@/types/roles";
import { TERMINAL_STATUSES } from "@/types/worklist";

// Statuts considérés comme "actifs" (non-terminaux) pour le calcul des retards.
const ACTIVE_STATUSES: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
  "READY_FOR_CM",
  "SCHEDULED",
  "DRAFT",
  "BLOCKED",
];

interface HomeAdminProps {
  userName: string | null | undefined;
}

/**
 * Tableau de bord Admin — refonte V4 MID Liquid Glass (cohérence avec
 * /calendar et /publications/[id]).
 *
 * Affiche des métriques globales utiles pour l'orchestrateur (slots en
 * retard, slots sans pattern, versions à valider) avec liens directs vers
 * /calendar, /admin/clients, /admin/accounts. L'Admin reste principalement
 * sur /calendar pour l'orchestration détaillée — utiliser Cmd+K pour la
 * recherche transverse.
 */
export async function HomeAdmin({ userName }: HomeAdminProps) {
  const now = new Date();

  const [overdueCount, noPatternCount, noMonteurCount, noVideasteCount, editReviewSlots] = await Promise.all([
    prisma.publicationSlot.count({
      where: {
        scheduledAt: { lt: now },
        status: { in: ACTIVE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)) },
      },
    }),
    prisma.publicationSlot.count({
      where: {
        patternId: null,
        status: { in: ACTIVE_STATUSES },
      },
    }),
    // B10 — Slots actifs sans monteur assigné. Sans cette assignation, ils
    // n'apparaissent dans la worklist d'aucun monteur (filtrage par
    // assigneeMonteurId) → invisibles tant que l'ADMIN ne les voit pas ici.
    prisma.publicationSlot.count({
      where: {
        assigneeMonteurId: null,
        status: { in: ACTIVE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)) },
      },
    }),
    // Slots actifs nécessitant un vidéaste (manual_rushes) mais sans assignation.
    prisma.publicationSlot.count({
      where: {
        assigneeVideasteId: null,
        status: { in: ["PLANNED", "RUSHES_EXPECTED"] },
      },
    }),
    // Slots en EDIT_REVIEW = version livrée, attend validation admin
    prisma.publicationSlot.findMany({
      where: { status: "EDIT_REVIEW" },
      select: {
        id: true,
        title: true,
        pattern: { select: { label: true } },
        account: { select: { handle: true, name: true } },
        versions: {
          where: { deletedAt: null },
          select: { versionNumber: true, createdAt: true },
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  // Formater la date du jour en français
  const todayLabel = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen">
      {/* Wrapper outer pastel — cohérent avec /calendar et fiche publication */}
      <div
        className="my-11 ml-[100px] mr-[100px] rounded-3xl"
        style={{ background: "var(--gradient-page-shell)" }}
      >
        <div className="px-6 sm:px-8 pt-6 pb-12">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Header glass — eyebrow + h1 + date */}
            <header className="rounded-2xl bg-white/55 backdrop-blur-[12px] backdrop-saturate-150 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
              <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">
                Tableau de bord
              </p>
              <h1 className="mt-1 text-[28px] sm:text-[32px] font-semibold tracking-tight text-gray-950">
                Bonjour{userName ? `, ${userName.split(" ")[0]}` : ""}
              </h1>
              <p className="mt-1 text-[12px] text-gray-500 capitalize">{todayLabel}</p>
            </header>

            {/* Métriques globales — chaque carte filtre le calendrier via
                ?filter= sur la query string (Phase nav audit 2026-05-28).
                V4 refonte : glass cards + accents Coastal Studio (rose
                urgent, peach attention, sage ok). */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard
                href="/calendar?filter=overdue"
                icon={AlertTriangle}
                label="Slots en retard"
                count={overdueCount}
                tone="rose"
                title="Voir les slots en retard"
              />
              <KpiCard
                href="/calendar?filter=no-pattern"
                icon={FileQuestion}
                label="Sans pattern"
                count={noPatternCount}
                tone="peach"
                title="Voir les slots sans pattern"
              />
              <KpiCard
                href="/calendar?filter=no-monteur"
                icon={UserX}
                label="Sans monteur"
                count={noMonteurCount}
                tone="peach"
                title="Voir les slots sans monteur assigné"
              />
              <KpiCard
                href="/calendar?filter=no-videaste"
                icon={Video}
                label="Sans vidéaste"
                count={noVideasteCount}
                tone="peach"
                title="Voir les slots sans vidéaste assigné"
              />
            </div>

            {/* Widget "Versions à valider" — glass sky */}
            <section className="rounded-2xl bg-gradient-to-b from-sky-50/85 to-sky-50/45 backdrop-blur-[12px] backdrop-saturate-150 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(125,180,210,0.28)]">
              <div className="flex items-center gap-2 mb-3">
                <Film size={15} className="text-sky-700 shrink-0" />
                <h2 className="text-[13px] font-semibold text-sky-900">Versions à valider</h2>
                {editReviewSlots.length > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium bg-sky-200/70 text-sky-900">
                    {editReviewSlots.length}
                  </span>
                )}
              </div>

              {editReviewSlots.length === 0 ? (
                <p className="text-[12px] text-sky-700/70 italic">
                  Toutes les versions sont à jour.
                </p>
              ) : (
                <div className="space-y-2">
                  {editReviewSlots.map((slot) => {
                    const latestVersion = slot.versions[0];
                    const versionLabel = latestVersion ? `V${latestVersion.versionNumber}` : "Version";
                    const uploadDate = latestVersion
                      ? new Date(latestVersion.createdAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                        })
                      : null;

                    return (
                      <Link
                        key={slot.id}
                        href={`/publications/${slot.id}`}
                        className="flex items-center justify-between bg-white/70 backdrop-blur-[8px] rounded-xl px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/90 transition-colors group"
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-gray-950 truncate">
                            {slot.pattern?.label ?? slot.title ?? "Publication"}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            @{slot.account.handle}
                            {slot.account.name !== slot.account.handle && (
                              <span className="text-gray-400"> · {slot.account.name}</span>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2 ml-3">
                          <span className="text-[11px] font-medium text-sky-800 bg-sky-100/70 px-1.5 py-0.5 rounded">
                            {versionLabel} en attente
                          </span>
                          {uploadDate && (
                            <span className="text-[10px] text-gray-400 hidden sm:block">
                              {uploadDate}
                            </span>
                          )}
                          <ArrowRight
                            size={12}
                            className="text-sky-500 group-hover:text-sky-700 transition-colors"
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Lien principal vers le calendrier — glass sage prononcé */}
            <Link
              href="/calendar"
              className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-b from-sage-50/85 to-sage-50/45 backdrop-blur-[12px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.28)] hover:from-sage-50/95 hover:to-sage-50/55 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <CalendarDays size={20} className="text-sage-700" />
                <div>
                  <p className="text-[14px] font-semibold text-sage-900">
                    Ouvrir le calendrier éditorial
                  </p>
                  <p className="text-[11px] text-sage-700/80 mt-0.5">
                    Planification, assignation, statuts complets
                  </p>
                </div>
              </div>
              <ArrowRight
                size={16}
                className="text-sage-600 group-hover:translate-x-0.5 transition-transform"
              />
            </Link>

            {/* Liens secondaires — glass subtil */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/admin/accounts"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700"
              >
                <CalendarClock size={14} className="text-gray-500 shrink-0" />
                Gérer les comptes Instagram
              </Link>
              <Link
                href="/admin/clients"
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)] hover:bg-white/85 transition-colors text-[12.5px] text-gray-700"
              >
                <Building2 size={14} className="text-gray-500 shrink-0" />
                Gérer les clients
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sous-composant KpiCard ─────────────────────────────────────────────────

type KpiTone = "rose" | "peach" | "sage" | "neutral";

const TONE_STYLES: Record<KpiTone, { container: string; iconActive: string; numberActive: string; ring: string }> = {
  rose: {
    container: "bg-gradient-to-b from-rose-50/85 to-rose-50/45",
    iconActive: "text-rose-700",
    numberActive: "text-rose-800",
    ring: "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(201,113,133,0.30)]",
  },
  peach: {
    container: "bg-gradient-to-b from-peach-50/85 to-peach-50/45",
    iconActive: "text-peach-700",
    numberActive: "text-peach-800",
    ring: "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(245,158,107,0.30)]",
  },
  sage: {
    container: "bg-gradient-to-b from-sage-50/85 to-sage-50/45",
    iconActive: "text-sage-700",
    numberActive: "text-sage-800",
    ring: "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(111,162,128,0.30)]",
  },
  neutral: {
    container: "bg-white/55",
    iconActive: "text-gray-700",
    numberActive: "text-gray-900",
    ring: "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]",
  },
};

function KpiCard({
  href,
  icon: Icon,
  label,
  count,
  tone,
  title,
}: {
  href: string;
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  tone: KpiTone;
  title: string;
}) {
  // Si count === 0, on bascule en variant neutre (l'attention n'est pas requise).
  const effectiveTone = count > 0 ? tone : "neutral";
  const styles = TONE_STYLES[effectiveTone];
  return (
    <Link
      href={href}
      className={`rounded-2xl backdrop-blur-[12px] backdrop-saturate-150 px-4 py-3.5 flex flex-col gap-1 transition-all hover:-translate-y-px ${styles.container} ${styles.ring}`}
      title={title}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} className={count > 0 ? styles.iconActive : "text-gray-400"} />
        <span className="text-[10.5px] uppercase tracking-widest font-medium text-gray-600">
          {label}
        </span>
      </div>
      <p
        className={`text-[28px] sm:text-[32px] font-semibold tracking-tight mt-1 ${
          count > 0 ? styles.numberActive : "text-gray-400"
        }`}
      >
        {count}
      </p>
    </Link>
  );
}
