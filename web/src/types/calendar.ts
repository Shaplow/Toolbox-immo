export type SlotStatus = "TO_DO" | "IN_PROGRESS" | "READY" | "CHECKING" | "DONE";

export type ContentType = "RPI" | "RVA4" | "RVA5" | "RTIPS" | "RPOD" | "REACT" | "RQR";

export interface PublicationSlot {
  id: string;
  accountId: string;
  account: { id: string; name: string; handle: string; offre: string };
  scheduledAt: string; // ISO
  contentType: string;
  status: SlotStatus;
  title: string | null;
  caption: string | null;
  notes: string | null;
  fields: Record<string, string>;
  fieldSchema: string[];
  templateId: string | null;
  template: { id: string; name: string } | null;
  render: { id: string; status: string; pngUrl: string | null; videoUrl: string | null } | null;
  isAuto: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OfferScheduleRule {
  id: string;
  offre: string;
  dayOfWeek: number;
  publishTime: string;
  contentType: string;
  templateId: string | null;
  template: { id: string; name: string; contentType: string } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_LABELS: Record<SlotStatus, string> = {
  TO_DO: "À faire",
  IN_PROGRESS: "En cours",
  READY: "Prêt",
  CHECKING: "Vérification",
  DONE: "Publié",
};

export const STATUS_COLORS: Record<SlotStatus, string> = {
  TO_DO: "bg-red-100 text-red-700 border-red-200",
  IN_PROGRESS: "bg-orange-100 text-orange-700 border-orange-200",
  READY: "bg-blue-100 text-blue-700 border-blue-200",
  CHECKING: "bg-amber-100 text-amber-700 border-amber-200",
  DONE: "bg-green-100 text-green-700 border-green-200",
};

export const STATUS_DOT: Record<SlotStatus, string> = {
  TO_DO: "bg-red-500",
  IN_PROGRESS: "bg-orange-500",
  READY: "bg-blue-500",
  CHECKING: "bg-amber-400",
  DONE: "bg-green-500",
};

export const CONTENT_TYPES: ContentType[] = ["RPI", "RVA4", "RVA5", "RTIPS", "RPOD", "REACT", "RQR"];
export const OFFRES = ["ESSENTIEL", "CONFIRME", "CEO", "COMPTE_AGENCE"] as const;
export type Offre = (typeof OFFRES)[number];
export const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
