/**
 * `Carrier` is the contract every adapter implements.
 *
 * Each capability is an OPTIONAL field: if a carrier does not support an
 * operation, it simply omits it. Callers check with `hasCapability` or by
 * direct presence:
 *
 *     if (carrier.rate) { ... }
 *
 * This is deliberately a "bag of capabilities" rather than a giant
 * required interface — it keeps the contract honest (no throw-on-call
 * stubs) and makes adding new operations a non-breaking change.
 */

import type {
  AddressValidationOperation,
  LabelPurchaseOperation,
  RateOperation,
  TrackingOperation,
} from "./operations"

export interface Carrier {
  /** Lower-case identifier, e.g. "ups", "fedex". */
  readonly name: string
  readonly rate?: RateOperation
  readonly label?: LabelPurchaseOperation
  readonly tracking?: TrackingOperation
  readonly addressValidation?: AddressValidationOperation
}

export type CarrierCapability = "rate" | "label" | "tracking" | "addressValidation"

export function hasCapability(carrier: Carrier, capability: CarrierCapability): boolean {
  return carrier[capability] !== undefined
}
