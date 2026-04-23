/**
 * End-to-end integration tests for the UPS Rate operation.
 *
 * The HTTP layer is stubbed but everything above it — validation, request
 * mapping, auth, response parsing, normalisation — runs for real.
 */

import { describe, expect, it } from "vitest"

import { UpsCarrier } from "../../src/carriers/ups"
import type { UpsConfig } from "../../src/carriers/ups"
import { MockHttpClient } from "./helpers/mock-http"
import { makeValidRateRequest } from "./helpers/fixtures"

import oauthSuccess from "./fixtures/ups-oauth-success.json"
import shopSuccess from "./fixtures/ups-rate-shop-success.json"
import singleSuccess from "./fixtures/ups-rate-single-success.json"

const baseConfig: UpsConfig = {
  baseUrl: "https://wwwcie.ups.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "A1B2C3",
  apiVersion: "v2409",
  timeoutMs: 5000,
}

describe("UPS Rate — Shop (no serviceCode)", () => {
  it("builds a correct /Shop request and normalises quotes", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, shopSuccess)

    const ups = new UpsCarrier(baseConfig, { http })
    const quotes = await ups.rate.execute(makeValidRateRequest())

    // --- request building ----------------------------------------------
    const tokenCall = http.findCall("/security/v1/oauth/token")
    expect(tokenCall, "should have called the token endpoint").toBeDefined()
    expect(tokenCall!.method).toBe("POST")
    expect(tokenCall!.headers?.Authorization).toMatch(/^Basic /)
    expect(tokenCall!.headers?.["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    )
    expect(tokenCall!.body).toBe("grant_type=client_credentials")

    const rateCall = http.findCall("/api/rating/v2409/Shop")
    expect(rateCall, "should have POSTed to the /Shop endpoint").toBeDefined()
    expect(rateCall!.method).toBe("POST")
    expect(rateCall!.headers?.Authorization).toBe(
      `Bearer ${oauthSuccess.access_token}`,
    )
    expect(rateCall!.headers?.transId).toBeTruthy()
    expect(rateCall!.headers?.transactionSrc).toBe(
      "cybership-carrier-integration",
    )

    const body = rateCall!.body as {
      RateRequest: {
        Shipment: {
          Shipper: { ShipperNumber?: string; Address: { PostalCode: string } }
          ShipTo: {
            Address: { ResidentialAddressIndicator?: string; CountryCode: string }
          }
          Package: Array<{
            PackageWeight: { Weight: string }
            Dimensions: { Length: string; Width: string; Height: string }
          }>
          Service?: unknown
          PickupType?: unknown
        }
      }
    }
    expect(body.RateRequest.Shipment.Shipper.ShipperNumber).toBe("A1B2C3")
    expect(body.RateRequest.Shipment.Shipper.Address.PostalCode).toBe("30303")
    expect(body.RateRequest.Shipment.ShipTo.Address.CountryCode).toBe("US")
    // UPS uses empty-string presence flags, not booleans.
    expect(
      body.RateRequest.Shipment.ShipTo.Address.ResidentialAddressIndicator,
    ).toBe("")
    // Shop mode: no Service node.
    expect(body.RateRequest.Shipment.Service).toBeUndefined()
    expect(body.RateRequest.Shipment.Package).toHaveLength(1)
    expect(body.RateRequest.Shipment.Package[0].PackageWeight.Weight).toBe("5")
    expect(body.RateRequest.Shipment.Package[0].Dimensions).toEqual({
      UnitOfMeasurement: { Code: "IN" },
      Length: "10",
      Width: "8",
      Height: "6",
    })

    // --- response normalisation ----------------------------------------
    expect(quotes).toHaveLength(3)

    const ground = quotes.find((q) => q.serviceCode === "03")!
    expect(ground).toBeDefined()
    expect(ground.carrier).toBe("ups")
    expect(ground.serviceName).toBe("UPS Ground")
    expect(ground.totalCharge).toEqual({ amount: 13.5, currency: "USD" })
    expect(ground.baseCharge).toEqual({ amount: 13.5, currency: "USD" })
    expect(ground.transitDays).toBe(5)
    expect(ground.guaranteed).toBe(true)
    expect(ground.surcharges).toEqual([
      {
        code: "375",
        description: "Residential Surcharge",
        amount: { amount: 4.95, currency: "USD" },
      },
    ])

    const twoDay = quotes.find((q) => q.serviceCode === "02")!
    expect(twoDay.serviceName).toBe("UPS 2nd Day Air")
    expect(twoDay.totalCharge.amount).toBe(24.12)
    // UPS 8-char date → ISO-8601.
    expect(twoDay.estimatedDeliveryDate).toBe("2026-04-28")

    // Negotiated total should win over list total.
    const overnight = quotes.find((q) => q.serviceCode === "01")!
    expect(overnight.totalCharge.amount).toBe(46.5)
  })
})

describe("UPS Rate — single service (serviceCode set)", () => {
  it("targets /Rate and handles an object (non-array) RatedShipment", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, singleSuccess)

    const ups = new UpsCarrier(baseConfig, { http })
    const quotes = await ups.rate.execute(
      makeValidRateRequest({ serviceCode: "03" }),
    )

    const call = http.findCall("/api/rating/")
    expect(call!.url).toContain("/api/rating/v2409/Rate")
    const body = call!.body as {
      RateRequest: { Shipment: { Service: { Code: string } } }
    }
    expect(body.RateRequest.Shipment.Service).toEqual({ Code: "03" })

    expect(quotes).toHaveLength(1)
    expect(quotes[0].serviceCode).toBe("03")
    expect(quotes[0].totalCharge.amount).toBe(13.5)
  })
})

describe("UPS Rate — validation", () => {
  it("rejects an invalid request before any network call", async () => {
    const http = new MockHttpClient()
    const ups = new UpsCarrier(baseConfig, { http })

    await expect(
      ups.rate.execute({
        // @ts-expect-error — intentionally missing fields
        shipper: { street1: "x" },
        recipient: {
          street1: "y",
          city: "Columbus",
          stateOrProvince: "OH",
          postalCode: "43215",
          countryCode: "US",
        },
        packages: [{ weight: { value: -1, unit: "lb" } }],
      }),
    ).rejects.toMatchObject({
      name: "ValidationError",
      code: "VALIDATION_ERROR",
    })

    expect(http.calls).toHaveLength(0)
  })

  it("upper-cases 2-letter country codes on the wire", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, shopSuccess)
    const ups = new UpsCarrier(baseConfig, { http })

    await ups.rate.execute(
      makeValidRateRequest({
        recipient: {
          ...makeValidRateRequest().recipient,
          countryCode: "us",
        },
      }),
    )

    const rateCall = http.findCall("/api/rating/")
    const body = rateCall!.body as {
      RateRequest: { Shipment: { ShipTo: { Address: { CountryCode: string } } } }
    }
    expect(body.RateRequest.Shipment.ShipTo.Address.CountryCode).toBe("US")
  })
})
