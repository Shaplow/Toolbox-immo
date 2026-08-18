"use client";

/**
 * DayOfWeekPicker — sélecteur multi-jours (1=Lun … 7=Dim, convention
 * `PatternBinding.dayOfWeek` / Prisma) en boutons toggle. Labels dérivés de
 * `DAY_LABELS` (types/calendar.ts) — source unique déjà utilisée par le
 * calendrier, pas de tableau "Lun/Mar/…" redéclaré localement.
 */

import { DAY_LABELS } from "@/types/calendar";

interface DayOfWeekPickerProps {
  value: number[];
  onChange: (value: number[]) => void;
}

export function DayOfWeekPicker({ value, onChange }: DayOfWeekPickerProps) {
  function toggle(d: number) {
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  }

  return (
    <div className="inline-flex gap-1.5 flex-wrap">
      {DAY_LABELS.map((label, idx) => {
        const d = idx + 1;
        const active = value.includes(d);
        return (
          <button
            type="button"
            key={d}
            onClick={() => toggle(d)}
            className={`h-8 px-3 rounded-md text-[12px] font-medium border transition-colors ${
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-foreground border-border hover:bg-muted"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
