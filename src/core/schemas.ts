/**
 * Runtime (zod) validation schemas mirroring the types in `./types.ts`.
 *
 * The static types are the authoritative contract for internal callers;
 * these schemas guard the boundary against untrusted input (HTTP bodies,
 * JSON from queues, etc.) before anything is sent to a carrier.
 */

import { z } from "zod"
import type {
  Address,
  Dimensions,
  MonetaryAmount,
  Package,
  RateRequest,
  Weight,
} from "./types"

export const AddressSchema = z.object({
  name: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  street1: z.string().min(1, "street1 is required"),
  street2: z.string().optional(),
  city: z.string().min(1, "city is required"),
  stateOrProvince: z.string().min(1, "stateOrProvince is required"),
  postalCode: z.string().min(1, "postalCode is required"),
  countryCode: z
    .string()
    .length(2, "countryCode must be a 2-letter ISO-3166 alpha-2 code")
    .regex(/^[A-Za-z]{2}$/, "countryCode must be alphabetic")
    .transform((v) => v.toUpperCase()),
  residential: z.boolean().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
}) satisfies z.ZodType<Address>

export const WeightSchema = z.object({
  value: z.number().positive("weight value must be > 0"),
  unit: z.enum(["lb", "kg"]),
}) satisfies z.ZodType<Weight>

export const DimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["in", "cm"]),
}) satisfies z.ZodType<Dimensions>

export const MonetaryAmountSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z
    .string()
    .length(3, "currency must be a 3-letter ISO-4217 code")
    .transform((v) => v.toUpperCase()),
}) satisfies z.ZodType<MonetaryAmount>

export const PackageSchema = z.object({
  weight: WeightSchema,
  dimensions: DimensionsSchema.optional(),
  packagingType: z
    .enum(["BOX", "ENVELOPE", "TUBE", "PAK", "PALLET", "CUSTOM"])
    .optional(),
  declaredValue: MonetaryAmountSchema.optional(),
  reference: z.string().optional(),
}) satisfies z.ZodType<Package>

export const RateRequestSchema = z.object({
  shipper: AddressSchema,
  recipient: AddressSchema,
  packages: z.array(PackageSchema).min(1, "at least one package is required"),
  serviceCode: z.string().min(1).optional(),
  shipDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "shipDate must be YYYY-MM-DD")
    .optional(),
  pickupType: z
    .enum([
      "DAILY_PICKUP",
      "CUSTOMER_COUNTER",
      "ONE_TIME_PICKUP",
      "ON_CALL_AIR",
      "SUGGESTED_RETAIL",
      "LETTER_CENTER",
      "AIR_SERVICE_CENTER",
    ])
    .optional(),
  rateType: z.enum(["RETAIL", "NEGOTIATED"]).optional(),
}) satisfies z.ZodType<RateRequest>

/**
 * Turn zod issues into our structured `CarrierErrorDetail[]` shape so
 * validation errors are consistent with every other error in the system.
 */
export function zodIssuesToDetails(err: z.ZodError) {
  return err.issues.map((i) => ({
    field: i.path.join(".") || undefined,
    message: i.message,
    code: i.code,
  }))
}
