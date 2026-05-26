"use client";

import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";

interface ImpersonationBannerProps {
  effectiveUserLabel: string;
}

export function ImpersonationBanner({ effectiveUserLabel }: ImpersonationBannerProps) {
  const router = useRouter();

  async function stopImpersonation() {
    await fetch("/api/admin/impersonation", { method: "DELETE" });
    router.push("/admin/users");
    router.refresh();
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-2 min-w-0 text-amber-900">
        <UserCog size={14} className="text-amber-600 shrink-0" />
        <span className="truncate">
          Vous êtes connecté en tant que{" "}
          <span className="font-semibold">{effectiveUserLabel}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => void stopImpersonation()}
        className="text-xs font-medium text-amber-800 hover:text-amber-950 transition-colors shrink-0"
      >
        Quitter l&apos;impersonation
      </button>
    </div>
  );
}
