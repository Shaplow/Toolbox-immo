import type { BoxPadding } from "@/lib/textBackground";
import { toUniformPaddingValue } from "./utils";

export function BoxPaddingEditor({
  label,
  values,
  split,
  onToggleSplit,
  onChangeUniform,
  onChangeSide,
}: {
  label: string;
  values: BoxPadding;
  split: boolean;
  onToggleSplit: (nextSplit: boolean) => void;
  onChangeUniform: (value: number) => void;
  onChangeSide: (side: keyof BoxPadding, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400">{label}</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => onToggleSplit(false)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              !split ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Uniforme
          </button>
          <button
            type="button"
            onClick={() => onToggleSplit(true)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              split ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Côtés
          </button>
        </div>
      </div>

      {split ? (
        <div className="grid grid-cols-2 gap-2">
          {([
            ["top", "Haut"],
            ["right", "Droite"],
            ["bottom", "Bas"],
            ["left", "Gauche"],
          ] as const).map(([side, sideLabel]) => (
            <label key={side} className="flex flex-col gap-0.5">
              <span className="text-gray-400">{sideLabel}</span>
              <input
                type="number"
                min={0}
                value={values[side]}
                onChange={(e) => onChangeSide(side, Number(e.target.value))}
                className="border border-gray-200 rounded px-2 py-1"
              />
            </label>
          ))}
        </div>
      ) : (
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Padding</span>
          <input
            type="number"
            min={0}
            value={toUniformPaddingValue(values)}
            onChange={(e) => onChangeUniform(Number(e.target.value))}
            className="border border-gray-200 rounded px-2 py-1"
          />
        </label>
      )}
    </div>
  );
}
