/**
 * Registry d'icônes des types de fiches (V3.2) — `EntityType.icon` est une
 * string libre en DB ; on la mappe sur un ensemble restreint de lucide pour
 * un rendu sûr (pas d'import dynamique). Inconnu/vide → FileStack.
 *
 * Les clés acceptées sont documentées dans l'aide de /admin/entity-types.
 */
import {
  Building2,
  CalendarClock,
  Camera,
  Clapperboard,
  FileStack,
  Flower2,
  Home,
  MapPin,
  Package,
  Shirt,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  building: Building2,
  clapperboard: Clapperboard,
  camera: Camera,
  calendar: CalendarClock,
  flower: Flower2,
  shirt: Shirt,
  store: Store,
  package: Package,
  users: Users,
  "map-pin": MapPin,
};

/** Liste des clés valides — affichée dans l'aide du formulaire de type. */
export const ENTITY_TYPE_ICON_KEYS = Object.keys(ICONS);

export function entityTypeIcon(name: string | null | undefined): LucideIcon {
  if (!name) return FileStack;
  return ICONS[name.trim().toLowerCase()] ?? FileStack;
}
