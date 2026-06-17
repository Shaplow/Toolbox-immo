/**
 * ToggleSwitch — switch ON/OFF compact réutilisé dans tous les panneaux
 * propriétés du builder. Avant l'extraction, ce composant était redéfini
 * à l'identique dans 5 fichiers de `properties/` (StyleEditor, VideoBlock,
 * DPEBlock, TextBlock, GroupProperties), ce qui rendait toute évolution
 * visuelle ou comportementale impossible à propager.
 */

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 w-full text-left"
    >
      <span
        className={[
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent",
          "transition-colors duration-150",
          checked ? "bg-indigo-600" : "bg-gray-200",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow",
            "transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </button>
  );
}
