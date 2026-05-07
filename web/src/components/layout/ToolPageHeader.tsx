import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const BG_MAP: Record<string, string> = {
  indigo:  "bg-indigo-600",
  violet:  "bg-violet-600",
  teal:    "bg-teal-600",
  emerald: "bg-emerald-600",
  amber:   "bg-amber-600",
  rose:    "bg-rose-600",
};

/**
 * Standard page header shared by all tool pages.
 * Renders a coloured icon, title, optional subtitle, and optional actions slot.
 * Works in both server components and client components.
 */
export function ToolPageHeader({
  icon: Icon,
  iconColor = "indigo",
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const bg = BG_MAP[iconColor] ?? "bg-indigo-600";
  return (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center text-white shrink-0`}>
          <Icon size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
