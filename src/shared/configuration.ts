import { z } from "zod";
import { webUrl, urlSchema } from "./resources";
const optionalUrl = z.union([z.literal(""), urlSchema]);
export const schedulingSchema = z
  .object({
    enabled: z.boolean(),
    providerLabel: z.string().trim().max(80),
    destinationUrl: z
      .string()
      .max(2048)
      .refine(
        (v) => v === "" || webUrl(v, true),
        "Enter an absolute HTTPS URL without credentials.",
      ),
    expectedRevision: z.number().int().positive(),
  })
  .strict()
  .refine((v) => !v.enabled || !!v.destinationUrl, {
    message: "Choose a destination before enabling scheduling.",
    path: ["destinationUrl"],
  });
export const cardSchema = z
  .object({
    published: z.boolean(),
    displayName: z.string().trim().min(1, "Enter a display name.").max(100),
    role: z.string().trim().max(100),
    organization: z.string().trim().max(100),
    intro: z.string().max(600),
    website: optionalUrl,
    publicEmail: z.union([z.literal(""), z.string().email().max(254)]),
    publicPhone: z
      .string()
      .max(50)
      .regex(
        /^[+0-9(). -]*$/,
        "Use a phone number, with an optional country code.",
      ),
    avatarBlobId: z.string().uuid().nullable(),
    showScheduling: z.boolean(),
    links: z
      .array(
        z
          .object({ label: z.string().trim().min(1).max(60), url: urlSchema })
          .strict(),
      )
      .max(10),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const settingsSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    websiteUrl: optionalUrl,
    accent: z.enum(["oxide", "blue", "green"]),
    showPoweredBy: z.boolean(),
    uploadMaxBytes: z.number().int().positive().max(26214400),
    quotaBytes: z.number().int().positive(),
    pasteMaxBytes: z.number().int().positive().max(262144),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type CardData = Omit<z.infer<typeof cardSchema>, "expectedRevision"> & {
  revision: number;
  updatedAt: number;
};
export type SchedulingData = Omit<
  z.infer<typeof schedulingSchema>,
  "expectedRevision"
> & { revision: number; updatedAt: number };
