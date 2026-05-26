import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Section({
  label,
  icon: Icon,
  action,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={11} className="text-gray-400 shrink-0" />}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
