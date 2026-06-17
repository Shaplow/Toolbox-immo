"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import {
  SYSTEM_DATE_PRESETS,
  buildMaintenantToken,
  formatSystemDate,
} from "@/lib/systemTokens";

export function DatePresetMenu({ onPick }: { onPick: (token: string) => void }) {
  const [now] = useState<Date>(() => new Date());

  const items = SYSTEM_DATE_PRESETS.map((preset) => ({
    label: `${formatSystemDate(preset.key, now)} · ${preset.label}`,
    onClick: () => onPick(buildMaintenantToken(preset.key)),
  }));

  return (
    <DropdownMenu
      align="start"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-border rounded-lg text-muted-foreground hover:bg-muted hover:border-indigo-300 hover:text-indigo-600 transition-colors"
        >
          <Calendar size={11} />
          + Date
        </button>
      }
      items={items}
    />
  );
}
