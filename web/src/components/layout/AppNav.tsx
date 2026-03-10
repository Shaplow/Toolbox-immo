"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { User } from "next-auth";

export function AppNav({ user }: { user: User | undefined }) {
  const pathname = usePathname();
  const isAdmin = (user as { role?: string })?.role === "ADMIN";

  // Parse user permissions (JSON string array on the user object)
  const rawPerms = (user as { permissions?: string })?.permissions ?? "[]";
  let userPerms: string[] = [];
  try { userPerms = JSON.parse(rawPerms) as string[]; } catch { userPerms = []; }
  const hasCaptions = userPerms.includes("captions");
  const hasTemplates =
    userPerms.includes("templates:view") ||
    userPerms.includes("templates:generate") ||
    userPerms.includes("templates:edit") ||
    userPerms.includes("templates:manage");

  const navItems = isAdmin
    ? [
        { href: "/home",           label: "Accueil",      icon: "⌂" },
        { href: "/listings",       label: "Listings",     icon: "☰" },
        { href: "/templates",      label: "Templates",    icon: "▦" },
        { href: "/tools/captions", label: "Captions",     icon: "CC" },
        { href: "/admin/users",    label: "Utilisateurs", icon: "⚙" },
      ]
    : [
        { href: "/home",           label: "Accueil",    icon: "⌂" },
        { href: "/listings",       label: "Listings",   icon: "☰" },
        ...(hasTemplates ? [{ href: "/templates", label: "Templates", icon: "▦" }] : []),
        ...(hasCaptions  ? [{ href: "/tools/captions", label: "Captions", icon: "CC" }] : []),
      ];

  return (
    <aside className="w-56 bg-white border-r border-gray-100 flex flex-col h-full shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">T</span>
          <span className="font-semibold text-gray-900 text-sm">Toolbox Immo</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <p className="text-xs text-gray-500 truncate mb-0.5">{user?.name ?? user?.email}</p>
        {isAdmin && <p className="text-[10px] text-indigo-700 mb-2">Administrateur</p>}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full text-left text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}

