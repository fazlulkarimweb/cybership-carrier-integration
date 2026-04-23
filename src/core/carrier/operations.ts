/**
 * Capability interfaces — one per carrier operation.
 *
 * Adding a new operation (label purchase, tracking, address validation,
 * pickup scheduling, …) means:
 *  1. Export a new interface here.
 *  2. Add it as an optional field on `Carrier` in `./carrier.ts`.
 *  3. Implement it on whichever carriers support it.
 *
 * Existing carriers that do not implement the new interface simply expose
 * `undefined` for that capability — no existing code needs to change.
 */

import type { RateQuote, RateRequest } from "../types"

export interface RateOperation {
  execute(request: RateRequest): Promise<RateQuote[]>
}

// --- Sketches of future operations, intentionally left without impls ------
// Each would get full types + a zod schema + carrier implementations
// following the same pattern as `RateOperation`.

export interface LabelPurchaseOperation {
  // execute(request: LabelPurchaseRequest): Promise<Label>
}

export interface TrackingOperation {
  // execute(trackingNumber: string): Promise<TrackingInfo>
}

export interface AddressValidationOperation {
  // execute(address: Address): Promise<AddressValidationResult>
}
