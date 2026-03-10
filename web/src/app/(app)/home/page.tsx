import { auth } from "@/lib/auth";
import Link from "next/link";

const tools = [
  {
    href: "/templates",
    label: "Template Generator",
    description: "Créez et gérez des templates visuels pour vos annonces immobilières. Générez des visuels personnalisés en quelques clics.",
    icon: "▦",
    color: "indigo",
    badge: null,
  },
  {
    href: "/tools/captions",
    label: "Captions",
    description: "Brûlez des sous-titres stylisés et animés dans vos vidéos de présentation. Animations mot par mot, highlights, polices personnalisées.",
    icon: "CC",
    color: "violet",
    badge: "Beta",
  },
];

const colorMap: Record<string, string> = {
  indigo: "bg-indigo-50 border-indigo-100 hover:border-indigo-300 group-hover:text-indigo-700",
  violet: "bg-violet-50 border-violet-100 hover:border-violet-300 group-hover:text-violet-600",
};

const iconColorMap: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700",
  violet: "bg-violet-100 text-violet-600",
};

const badgeColorMap: Record<string, string> = {
  indigo: "bg-indigo-100 text-indigo-700",
  violet: "bg-violet-100 text-violet-700",
};

export default async function HomePage() {
  const session = await auth();
  const user = session?.user as { name?: string; email?: string; role?: string; permissions?: string } | undefined;

  const isAdmin = user?.role === "ADMIN";
  let userPerms: string[] = [];
  try { userPerms = JSON.parse(user?.permissions ?? "[]") as string[]; } catch { userPerms = []; }

  const visibleTools = tools.filter(({ href }) => {
    if (isAdmin) return true;
    if (href === "/tools/captions") return userPerms.includes("captions");
    if (href === "/templates") return userPerms.includes("templates");
    return true;
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl mb-5 shadow-md">
          <span className="text-2xl font-bold text-white">T</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Toolbox Immo</h1>
        <p className="text-gray-500 text-base max-w-sm mx-auto">
          Bonjour{user?.name ? ` ${user.name.split(" ")[0]}` : ""} — choisissez un outil pour commencer.
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-2xl">
        {visibleTools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className={`group relative flex flex-col p-6 rounded-2xl border-2 transition-all duration-200 cursor-pointer ${colorMap[tool.color]}`}
          >
            {tool.badge && (
              <span className={`absolute top-4 right-4 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeColorMap[tool.color]}`}>
                {tool.badge}
              </span>
            )}
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold mb-4 ${iconColorMap[tool.color]}`}>
              {tool.icon}
            </div>
            <h2 className={`text-base font-semibold text-gray-900 mb-1.5 transition-colors ${colorMap[tool.color].split(" ").at(-1)}`}>
              {tool.label}
            </h2>
            <p className="text-sm text-gray-500 leading-relaxed">{tool.description}</p>
            <div className="mt-4 text-xs font-medium text-gray-400 group-hover:text-gray-600 transition-colors">
              Ouvrir →
            </div>
          </Link>
        ))}
      </div>

      {/* Quick access to listings */}
      <div className="mt-8 flex items-center gap-2">
        <Link
          href="/listings"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all"
        >
          <span>☰</span> Mes listings &amp; visuels générés
        </Link>
      </div>
    </div>
  );
}
