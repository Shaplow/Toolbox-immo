"use client";

/**
 * FileDropzone — zone de dépôt de fichiers, purement visuelle.
 *
 * Glisser-déposer ou clic (et Entrée / Espace au clavier) → `onFiles`. Ne fait
 * aucun upload : l'appelant décide quoi faire des fichiers. À distinguer de
 * MediaDropzone, couplée au contrat d'upload des rushs/versions de slot
 * (`upload-presign` / `upload-complete`).
 */

import { useRef, useState, type ReactNode } from "react";
import { Upload, type LucideIcon } from "lucide-react";

interface FileDropzoneProps {
  /** Attribut `accept` de l'input (ex. ".mp4,.mov"). */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Libellé accessible de la zone (par défaut : `title`). */
  ariaLabel?: string;
  className?: string;
}

export function FileDropzone({
  accept,
  multiple = true,
  disabled = false,
  onFiles,
  title,
  hint,
  icon: Icon = Upload,
  ariaLabel,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function emit(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(files);
  }

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled}
      className={[
        "rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors focus-ring",
        disabled
          ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
          : dragging
            ? "cursor-pointer border-primary bg-accent"
            : "cursor-pointer border-border bg-muted/40 hover:border-primary/50",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) emit(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          emit(event.target.files);
          event.target.value = "";
        }}
      />
      <Icon size={22} className="mx-auto text-muted-foreground" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
