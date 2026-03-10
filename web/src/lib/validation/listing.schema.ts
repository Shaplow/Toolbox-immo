import { z } from "zod";

const DPELetter = z.enum(["A", "B", "C", "D", "E", "F", "G"]);

export const listingSchema = z.object({
  title:                    z.string().min(1, "Titre requis"),
  address_short:            z.string().min(1, "Adresse requise"),
  price_eur:                z.coerce.number().positive("Prix requis"),
  fees_note:                z.string().min(1, "Mention honoraires requise"),
  hero_image:               z.string().optional(),
  logo:                     z.string().optional(),
  dpe_image:                z.string().optional(),
  agency_name:              z.string().min(1, "Nom agence requis"),
  agency_siren:             z.string().min(9, "SIREN requis (9 chiffres)").max(9),
  phone:                    z.string().optional(),
  website:                  z.string().url("URL invalide").optional().or(z.literal("")),
  qr_url:                   z.string().url("URL QR invalide").optional().or(z.literal("")),
  dpe_energy_letter:        DPELetter,
  dpe_climate_letter:       DPELetter,
  energy_cost_min:          z.coerce.number().nonnegative(),
  energy_cost_max:          z.coerce.number().nonnegative(),
  energy_cost_year_index:   z.coerce.number().int().min(2000).max(2100),
  is_copro:                 z.boolean().optional(),
  lots_count:               z.coerce.number().int().positive().optional(),
  annual_charges:           z.coerce.number().nonnegative().optional(),
  procedure_in_progress:    z.boolean().optional(),
});

export type ListingFormValues = z.infer<typeof listingSchema>;
