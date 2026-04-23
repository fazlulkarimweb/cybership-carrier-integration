/**
 * Shared helpers for assembling valid domain objects in tests.
 *
 * Centralising this means a schema change won't require updating every
 * test file.
 */

import type { RateRequest } from "../../../src/core/types"

export function makeValidRateRequest(overrides: Partial<RateRequest> = {}): RateRequest {
  return {
    shipper: {
      name: "Jane Doe",
      company: "ACME Corp",
      street1: "123 Warehouse Way",
      city: "Atlanta",
      stateOrProvince: "GA",
      postalCode: "30303",
      countryCode: "US",
    },
    recipient: {
      name: "John Smith",
      street1: "500 Customer Lane",
      city: "Columbus",
      stateOrProvince: "OH",
      postalCode: "43215",
      countryCode: "US",
      residential: true,
    },
    packages: [
      {
        weight: { value: 5, unit: "lb" },
        dimensions: { length: 10, width: 8, height: 6, unit: "in" },
        packagingType: "BOX",
      },
    ],
    ...overrides,
  }
}
