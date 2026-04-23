/**
 * Shared, carrier-agnostic domain types.
 *
 * These are the ONLY shapes callers ever see. Each carrier adapter is
 * responsible for translating between these and its own wire format. The
 * integrity of this boundary is what lets us add FedEx/USPS/DHL later without
 * the rest of the platform knowing.
 */

export type LengthUnit = "in" | "cm"
export type WeightUnit = "lb" | "kg"

/** ISO-4217 currency code (e.g. "USD"). */
export type CurrencyCode = string

/** ISO-3166 alpha-2 country code (e.g. "US", "CA"). */
export type CountryCode = string

export interface Address {
  /** Contact / person name. */
  name?: string
  company?: string
  street1: string
  street2?: string
  city: string
  /** State, province, or region code (e.g. "CA", "ON"). */
  stateOrProvince: string
  postalCode: string
  countryCode: CountryCode
  /** True when the destination is a residence. Affects surcharges on most carriers. */
  residential?: boolean
  phone?: string
  email?: string
}

export interface Dimensions {
  length: number
  width: number
  height: number
  unit: LengthUnit
}

export interface Weight {
  value: number
  unit: WeightUnit
}

export interface MonetaryAmount {
  amount: number
  currency: CurrencyCode
}

export type PackagingType =
  | "BOX"
  | "ENVELOPE"
  | "TUBE"
  | "PAK"
  | "PALLET"
  | "CUSTOM"

export interface Package {
  weight: Weight
  dimensions?: Dimensions
  packagingType?: PackagingType
  declaredValue?: MonetaryAmount
  /** Caller-provided reference (order id, line item id, etc.) echoed back in responses. */
  reference?: string
}

export type PickupType =
  | "DAILY_PICKUP"
  | "CUSTOMER_COUNTER"
  | "ONE_TIME_PICKUP"
  | "ON_CALL_AIR"
  | "SUGGESTED_RETAIL"
  | "LETTER_CENTER"
  | "AIR_SERVICE_CENTER"

export type RateType = "RETAIL" | "NEGOTIATED"

export interface RateRequest {
  shipper: Address
  recipient: Address
  packages: Package[]
  /**
   * Optional carrier-specific service code. If omitted, the adapter will
   * "shop" — i.e. return quotes for every eligible service level.
   */
  serviceCode?: string
  /** ISO-8601 date (YYYY-MM-DD). Defaults to today in the carrier adapter. */
  shipDate?: string
  pickupType?: PickupType
  rateType?: RateType
}

export interface Surcharge {
  code: string
  description?: string
  amount: MonetaryAmount
}

export interface RateQuote {
  /** Lower-case carrier name, e.g. "ups". */
  carrier: string
  /** Carrier-specific service code (e.g. UPS "03"). */
  serviceCode: string
  /** Human-readable service name (e.g. "UPS Ground"). */
  serviceName: string
  totalCharge: MonetaryAmount
  baseCharge?: MonetaryAmount
  surcharges?: Surcharge[]
  currency: CurrencyCode
  transitDays?: number
  /** ISO-8601 date (YYYY-MM-DD) if the carrier provided one. */
  estimatedDeliveryDate?: string
  guaranteed?: boolean
  /**
   * The raw carrier response fragment for this quote. Useful for debugging
   * and audit trails but NOT part of the stable public contract — never code
   * against this field.
   */
  raw?: unknown
}
