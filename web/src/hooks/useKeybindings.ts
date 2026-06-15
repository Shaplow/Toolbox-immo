"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export interface Keybinding {
  /**
   * Spec : `"j"` | `"ArrowDown"` | `"k+Meta"` | `"Enter+Shift"` | `"o+Meta"`.
   * - Key insensible à la casse pour les lettres.
   * - Modifiers : `Meta` (cmd macOS), `Ctrl`, `Shift`, `Alt`.
   */
  key: string;
  handler: (e: KeyboardEvent) => void;
  /** Si false, ne pas preventDefault (par défaut on bloque pour éviter l'écho navigateur). */
  preventDefault?: boolean;
  /** Conditionnel — le binding ne s'applique que si `when()` renvoie true. */
  when?: () => boolean;
}

/**
 * Hook registry de raccourcis clavier.
 *
 * - Ne déclenche **pas** si le focus est dans un champ texte (input, textarea,
 *   contenteditable). Évite que J/K en train de taper un nom d'assignee n'ouvre
 *   un autre slot.
 * - Respecte les modifiers : `"j"` sans modifier matche uniquement la touche J seule
 *   (pas ⌘J, pas Shift+J).
 * - Les bindings sont stockés dans une ref pour éviter de re-binder l'event
 *   listener à chaque rerender.
 *
 * Usage :
 *   useKeybindings([
 *     { key: "j", handler: () => cursor.next() },
 *     { key: "k", handler: () => cursor.prev() },
 *     { key: "ArrowDown", handler: () => cursor.next() },
 *     { key: "ArrowUp", handler: () => cursor.prev() },
 *     { key: "o+Meta", handler: () => router.push("/publications/...") },
 *   ]);
 */
export function useKeybindings(
  bindings: Keybinding[],
  options?: { enabled?: boolean },
) {
  const ref = useRef(bindings);
  useLayoutEffect(() => {
    ref.current = bindings;
  }, [bindings]);

  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isInTextField(e.target)) return;
      for (const b of ref.current) {
        if (!matchKey(e, b.key)) continue;
        if (b.when && !b.when()) continue;
        b.handler(e);
        if (b.preventDefault !== false) e.preventDefault();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * Helper pur (testable) : matche un KeyboardEvent contre une spec textuelle.
 * Spec : `"j"` | `"ArrowDown"` | `"k+Meta"` | `"Enter+Shift"`.
 */
export function matchKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  spec: string,
): boolean {
  const parts = spec.split("+");
  const expectedKey = parts[0];
  const mods = parts.slice(1).map((m) => m.toLowerCase());

  // Match key (case insensitive pour les lettres, exact pour les special keys).
  const eKey = e.key;
  const expectedLower = expectedKey.toLowerCase();
  const eKeyLower = eKey.toLowerCase();
  if (eKeyLower !== expectedLower && eKey !== expectedKey) return false;

  const wantsMeta = mods.includes("meta") || mods.includes("cmd");
  const wantsCtrl = mods.includes("ctrl");
  const wantsShift = mods.includes("shift");
  const wantsAlt = mods.includes("alt");

  if (wantsMeta !== e.metaKey) return false;
  if (wantsCtrl !== e.ctrlKey) return false;
  if (wantsShift !== e.shiftKey) return false;
  if (wantsAlt !== e.altKey) return false;

  return true;
}

/** Helper pur : true si le target est un champ texte focusé. */
export function isInTextField(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
