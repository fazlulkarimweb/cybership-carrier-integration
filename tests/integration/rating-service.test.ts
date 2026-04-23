/**
 * Tests the high-level RatingService + CarrierRegistry surface. Verifies
 * that adding a second carrier works without touching UPS code — the
 * extensibility acceptance test.
 */

import { describe, expect, it } from "vitest"

import { UpsCarrier } from "../../src/carriers/ups"
import type { UpsConfig } from "../../src/carriers/ups"
import { CarrierRegistry } from "../../src/core/carrier/registry"
import { CarrierError } from "../../src/core/errors"
import { RatingService } from "../../src/services/rating-service"
import type { Carrier } from "../../src/core/carrier/carrier"
import type { RateQuote, RateRequest } from "../../src/core/types"
import { MockHttpClient } from "./helpers/mock-http"
import { makeValidRateRequest } from "./helpers/fixtures"

import oauthSuccess from "./fixtures/ups-oauth-success.json"
import shopSuccess from "./fixtures/ups-rate-shop-success.json"
import error400 from "./fixtures/ups-rate-error-400.json"

const upsConfig: UpsConfig = {
  baseUrl: "https://wwwcie.ups.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "A1B2C3",
  apiVersion: "v2409",
  timeoutMs: 5000,
}

/**
 * A second carrier used purely to prove the extensibility story — adding
 * it required zero changes to any existing file.
 */
class FakeFedex implements Carrier {
  readonly name = "fedex"
  readonly rate = {
    async execute(_req: RateRequest): Promise<RateQuote[]> {
      return [
        {
          carrier: "fedex",
          serviceCode: "FEDEX_GROUND",
          serviceName: "FedEx Ground",
          totalCharge: { amount: 11.25, currency: "USD" },
          currency: "USD",
          transitDays: 4,
        },
      ]
    },
  }
}

describe("RatingService — rate shopping across carriers", () => {
  it("merges quotes from every registered carrier with a rate capability", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, shopSuccess)

    const registry = new CarrierRegistry()
      .register(new UpsCarrier(upsConfig, { http }))
      .register(new FakeFedex())

    const service = new RatingService(registry)
    const { quotes, errors } = await service.rate(makeValidRateRequest())

    expect(errors).toHaveLength(0)
    expect(quotes).toHaveLength(4) // 3 UPS + 1 FedEx
    expect(quotes.filter((q) => q.carrier === "ups")).toHaveLength(3)
    expect(quotes.filter((q) => q.carrier === "fedex")).toHaveLength(1)
  })

  it("shops only a subset when `carriers` option is supplied", async () => {
    const http = new MockHttpClient() // never called
    const registry = new CarrierRegistry()
      .register(new UpsCarrier(upsConfig, { http }))
      .register(new FakeFedex())

    const { quotes } = await new RatingService(registry).rate(
      makeValidRateRequest(),
      { carriers: ["fedex"] },
    )
    expect(quotes).toHaveLength(1)
    expect(quotes[0].carrier).toBe("fedex")
    expect(http.calls).toHaveLength(0)
  })

  it("validates the request once at the service boundary", async () => {
    const registry = new CarrierRegistry().register(new FakeFedex())
    const service = new RatingService(registry)

    await expect(
      service.rate({
        // @ts-expect-error intentional
        shipper: null,
        recipient: null,
        packages: [],
      }),
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "VALIDATION_ERROR",
    })
  })
})

describe("RatingService — strict vs partial failure modes", () => {
  it("strict mode: throws when any carrier fails", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(400, error400)

    const registry = new CarrierRegistry()
      .register(new UpsCarrier(upsConfig, { http }))
      .register(new FakeFedex())

    await expect(
      new RatingService(registry).rate(makeValidRateRequest()),
    ).rejects.toBeInstanceOf(CarrierError)
  })

  it("allowPartial: returns successful quotes alongside an errors array", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(400, error400)

    const registry = new CarrierRegistry()
      .register(new UpsCarrier(upsConfig, { http }))
      .register(new FakeFedex())

    const result = await new RatingService(registry).rate(
      makeValidRateRequest(),
      { allowPartial: true },
    )
    expect(result.quotes).toHaveLength(1)
    expect(result.quotes[0].carrier).toBe("fedex")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].carrier).toBe("ups")
    expect(result.errors[0].error.code).toBe("CARRIER_ERROR")
  })
})

describe("CarrierRegistry", () => {
  it("lists carriers by capability", () => {
    const noRateCarrier: Carrier = { name: "ghost" }
    const registry = new CarrierRegistry()
      .register(new FakeFedex())
      .register(noRateCarrier)

    expect(registry.list()).toEqual(["fedex", "ghost"])
    expect(registry.listWithCapability("rate")).toEqual(["fedex"])
    expect(registry.has("fedex")).toBe(true)
    expect(registry.has("FEDEX")).toBe(true) // case-insensitive
    expect(registry.tryGet("does-not-exist")).toBeUndefined()
    expect(() => registry.get("does-not-exist")).toThrow(/not registered/)
  })
})
