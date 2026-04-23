/**
 * Error-path integration tests.
 *
 * Verifies that every realistic failure mode — 4xx, 5xx, rate limiting,
 * malformed JSON, network failures, timeouts — surfaces as a structured
 * `CarrierError` with the right code, status, and retryable flag.
 */

import { describe, expect, it } from "vitest"

import { UpsCarrier } from "../../src/carriers/ups"
import type { UpsConfig } from "../../src/carriers/ups"
import { FetchHttpClient } from "../../src/core/http/fetch-client"
import { MockHttpClient } from "./helpers/mock-http"
import { makeValidRateRequest } from "./helpers/fixtures"

import oauthSuccess from "./fixtures/ups-oauth-success.json"
import error400 from "./fixtures/ups-rate-error-400.json"
import error429 from "./fixtures/ups-rate-error-429.json"
import error500 from "./fixtures/ups-rate-error-500.json"

const config: UpsConfig = {
  baseUrl: "https://wwwcie.ups.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "A1B2C3",
  apiVersion: "v2409",
  timeoutMs: 5000,
}

describe("UPS Rate — error mapping", () => {
  it("maps a 400 body to a CARRIER_ERROR with parsed details", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(400, error400)

    const ups = new UpsCarrier(config, { http })
    await expect(
      ups.rate.execute(makeValidRateRequest()),
    ).rejects.toMatchObject({
      name: "CarrierError",
      code: "CARRIER_ERROR",
      httpStatus: 400,
      carrier: "ups",
      retryable: false,
      message: error400.response.errors[0].message,
      details: [
        {
          code: error400.response.errors[0].code,
          message: error400.response.errors[0].message,
        },
      ],
    })
  })

  it("maps a 429 body to a RateLimitError with retryAfterSeconds", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(429, error429, { "retry-after": "30" })

    const ups = new UpsCarrier(config, { http })
    const err = await catchErr(() =>
      ups.rate.execute(makeValidRateRequest()),
    )
    expect(err).toMatchObject({
      name: "RateLimitError",
      code: "RATE_LIMITED",
      httpStatus: 429,
      carrier: "ups",
      retryable: true,
    })
    expect((err as { retryAfterSeconds: number }).retryAfterSeconds).toBe(30)
  })

  it("maps a 5xx response to a retryable CARRIER_ERROR", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(503, error500)

    const ups = new UpsCarrier(config, { http })
    await expect(
      ups.rate.execute(makeValidRateRequest()),
    ).rejects.toMatchObject({
      name: "CarrierError",
      code: "CARRIER_ERROR",
      httpStatus: 503,
      retryable: true,
      carrier: "ups",
    })
  })

  it("serialises errors via toJSON()", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(400, error400)

    const ups = new UpsCarrier(config, { http })
    const err = await catchErr(() =>
      ups.rate.execute(makeValidRateRequest()),
    )
    const json = (err as { toJSON(): Record<string, unknown> }).toJSON()
    expect(json).toMatchObject({
      code: "CARRIER_ERROR",
      carrier: "ups",
      httpStatus: 400,
      retryable: false,
    })
    expect(Array.isArray(json.details)).toBe(true)
  })
})

describe("UPS Rate — response parsing failures", () => {
  it("raises MalformedResponseError for 2xx with non-JSON body", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueue({
        status: 200,
        rawBody: "<html>definitely not json</html>",
        headers: { "content-type": "text/html" },
      })

    const ups = new UpsCarrier(config, { http })
    await expect(
      ups.rate.execute(makeValidRateRequest()),
    ).rejects.toMatchObject({
      name: "MalformedResponseError",
      code: "MALFORMED_RESPONSE",
    })
  })

  it("raises MalformedResponseError when RatedShipment is missing", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, { RateResponse: { Response: { ResponseStatus: { Code: "1" } } } })

    const ups = new UpsCarrier(config, { http })
    await expect(
      ups.rate.execute(makeValidRateRequest()),
    ).rejects.toMatchObject({
      name: "MalformedResponseError",
      message: /RatedShipment/,
    })
  })
})

describe("FetchHttpClient — network failure modes", () => {
  it("maps an AbortError (timeout) into a TimeoutError", async () => {
    // Use a fetch impl that never resolves so the AbortController fires.
    const neverResolves: typeof fetch = () => new Promise(() => {})
    const http = new FetchHttpClient({
      fetchImpl: neverResolves,
      defaultTimeoutMs: 10,
    })

    await expect(
      http.request({ method: "GET", url: "https://example.test/never" }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      code: "TIMEOUT",
      retryable: true,
    })
  })

  it("maps a generic fetch rejection into a NetworkError", async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError("fetch failed")
    }
    const http = new FetchHttpClient({ fetchImpl: failingFetch })

    await expect(
      http.request({ method: "GET", url: "https://example.test/unreachable" }),
    ).rejects.toMatchObject({
      name: "NetworkError",
      code: "NETWORK_ERROR",
      retryable: true,
    })
  })

  it("raises MalformedResponseError when a 2xx JSON response is actually invalid JSON", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("{ invalid json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const http = new FetchHttpClient({ fetchImpl: fakeFetch })

    await expect(
      http.request({ method: "GET", url: "https://example.test/bad" }),
    ).rejects.toMatchObject({
      name: "MalformedResponseError",
      code: "MALFORMED_RESPONSE",
    })
  })
})

async function catchErr(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    throw new Error("expected function to throw")
  } catch (e) {
    return e
  }
}
