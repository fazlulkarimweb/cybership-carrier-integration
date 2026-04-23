/**
 * Static mappings between UPS wire-format codes and our domain enums.
 *
 * Kept in a single file so the mappers stay focused on structure and so
 * the "what does code 03 mean" question has one answer.
 */

import type { PackagingType, PickupType } from "../../core/types"

export const UPS_PACKAGING_CODE: Record<PackagingType, string> = {
  ENVELOPE: "01",
  BOX: "02",
  TUBE: "03",
  PAK: "04",
  PALLET: "30",
  // Fall-through — UPS treats "other packaging" as a customer-supplied box.
  CUSTOM: "02",
}

export const UPS_PICKUP_CODE: Record<PickupType, string> = {
  DAILY_PICKUP: "01",
  CUSTOMER_COUNTER: "03",
  ONE_TIME_PICKUP: "06",
  ON_CALL_AIR: "07",
  SUGGESTED_RETAIL: "11",
  LETTER_CENTER: "19",
  AIR_SERVICE_CENTER: "20",
}

/**
 * UPS service code → human-readable name.
 *
 * Scope: all services documented for US-origin shipments plus the common
 * international services. Adding more is a one-line change.
 */
export const UPS_SERVICE_NAME: Record<string, string> = {
  "01": "UPS Next Day Air",
  "02": "UPS 2nd Day Air",
  "03": "UPS Ground",
  "07": "UPS Worldwide Express",
  "08": "UPS Worldwide Expedited",
  "11": "UPS Standard",
  "12": "UPS 3 Day Select",
  "13": "UPS Next Day Air Saver",
  "14": "UPS Next Day Air Early",
  "54": "UPS Worldwide Express Plus",
  "59": "UPS 2nd Day Air A.M.",
  "65": "UPS Worldwide Saver",
  "96": "UPS Worldwide Express Freight",
}

export function upsServiceName(code: string): string {
  return UPS_SERVICE_NAME[code] ?? `UPS Service ${code}`
}
