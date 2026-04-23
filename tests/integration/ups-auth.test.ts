/**
 * OAuth token lifecycle: acquisition, reuse, coalescing, and transparent
 * refresh on 401.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { UpsCarrier } from "../../src/carriers/ups"
import type { UpsConfig } from "../../src/carriers/ups"
import { OAuthClientCredentialsTokenManager } from "../../src/core/auth/oauth-client-credentials"
import { MockHttpClient } from "./helpers/mock-http"
import { makeValidRateRequest } from "./helpers/fixtures"

import oauthSuccess from "./fixtures/ups-oauth-success.json"
import shopSuccess from "./fixtures/ups-rate-shop-success.json"
import error401 from "./fixtures/ups-rate-error-401.json"

const baseConfig: UpsConfig = {
  baseUrl: "https://wwwcie.ups.com",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  accountNumber: "A1B2C3",
  apiVersion: "v2409",
  timeoutMs: 5000,
}

afterEach(() => {
  vi.useRealTimers()
})

describe("OAuth — caching & reuse", () => {
  it("fetches a token once and reuses it for subsequent rate calls", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess) // single token acquisition
      .enqueueJson(200, shopSuccess) // call #1
      .enqueueJson(200, shopSuccess) // call #2
      .enqueueJson(200, shopSuccess) // call #3

    const ups = new UpsCarrier(baseConfig, { http })
    await ups.rate.execute(makeValidRateRequest())
    await ups.rate.execute(makeValidRateRequest())
    await ups.rate.execute(makeValidRateRequest())

    const tokenCalls = http.calls.filter((c) =>
      c.url.includes("/security/v1/oauth/token"),
    )
    expect(tokenCalls).toHaveLength(1)
  })

  it("coalesces concurrent token requests into a single network call", async () => {
    // Three parallel rate executions must produce exactly one OAuth call.
    // If coalescing were broken, the second parallel getToken() would fail
    // with "no response queued" because only one OAuth response is
    // enqueued.
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(200, shopSuccess)
      .enqueueJson(200, shopSuccess)
      .enqueueJson(200, shopSuccess)

    const ups = new UpsCarrier(baseConfig, { http })
    await Promise.all([
      ups.rate.execute(makeValidRateRequest()),
      ups.rate.execute(makeValidRateRequest()),
      ups.rate.execute(makeValidRateRequest()),
    ])

    const tokenCalls = http.calls.filter((c) =>
      c.url.includes("/security/v1/oauth/token"),
    )
    expect(tokenCalls).toHaveLength(1)
    expect(http.pending).toBe(0)
  })
})

describe("OAuth — expiry refresh", () => {
  it("refreshes the token after it expires", async () => {
    vi.useFakeTimers({ now: 0 })

    const http = new MockHttpClient()
    // First token expires in 120s. With the default 60s clock skew that
    // gives an effective TTL of 60s.
    http.enqueueJson(200, { ...oauthSuccess, expires_in: "120" })
    http.enqueueJson(200, shopSuccess)
    // Second token issued after expiry.
    http.enqueueJson(200, {
      ...oauthSuccess,
      access_token: "SECOND-TOKEN",
      expires_in: "120",
    })
    http.enqueueJson(200, shopSuccess)

    const ups = new UpsCarrier(baseConfig, { http })

    await ups.rate.execute(makeValidRateRequest())
    // Advance past the effective TTL.
    vi.setSystemTime(61_000)
    await ups.rate.execute(makeValidRateRequest())

    const tokenCalls = http.calls.filter((c) =>
      c.url.includes("/security/v1/oauth/token"),
    )
    expect(tokenCalls).toHaveLength(2)

    // The second rate call must have used the refreshed token.
    const rateCalls = http.calls.filter((c) =>
      c.url.includes("/api/rating/"),
    )
    expect(rateCalls[0].headers?.Authorization).toBe(
      `Bearer ${oauthSuccess.access_token}`,
    )
    expect(rateCalls[1].headers?.Authorization).toBe("Bearer SECOND-TOKEN")
  })
})

describe("OAuth — transparent refresh on 401", () => {
  it("invalidates the cached token on 401 and retries exactly once", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess) // initial token
      .enqueueJson(401, error401) // rate call rejected
      .enqueueJson(200, { ...oauthSuccess, access_token: "REFRESHED-TOKEN" }) // new token
      .enqueueJson(200, shopSuccess) // retried rate call succeeds

    const ups = new UpsCarrier(baseConfig, { http })
    const quotes = await ups.rate.execute(makeValidRateRequest())
    expect(quotes).toHaveLength(3)

    const rateCalls = http.calls.filter((c) =>
      c.url.includes("/api/rating/"),
    )
    expect(rateCalls).toHaveLength(2)
    expect(rateCalls[0].headers?.Authorization).toBe(
      `Bearer ${oauthSuccess.access_token}`,
    )
    expect(rateCalls[1].headers?.Authorization).toBe("Bearer REFRESHED-TOKEN")
    expect(http.pending).toBe(0)
  })

  it("surfaces an AuthError if the second attempt also fails", async () => {
    const http = new MockHttpClient()
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(401, error401)
      .enqueueJson(200, oauthSuccess)
      .enqueueJson(401, error401)

    const ups = new UpsCarrier(baseConfig, { http })
    await expect(ups.rate.execute(makeValidRateRequest())).rejects.toMatchObject({
      name: "AuthError",
      code: "AUTH_ERROR",
      httpStatus: 401,
      carrier: "ups",
    })
  })
})

describe("OAuth — token request failures", () => {
  it("maps a 401 from the token endpoint to AuthError", async () => {
    const http = new MockHttpClient().enqueueJson(401, {
      error: "invalid_client",
      error_description: "Client authentication failed",
    })
    const auth = new OAuthClientCredentialsTokenManager(http, {
      tokenUrl: "https://wwwcie.ups.com/security/v1/oauth/token",
      clientId: "x",
      clientSecret: "y",
      carrier: "ups",
    })

    await expect(auth.getToken()).rejects.toMatchObject({
      name: "AuthError",
      code: "AUTH_ERROR",
      httpStatus: 401,
      carrier: "ups",
    })
  })

  it("maps a missing access_token to MalformedResponseError", async () => {
    const http = new MockHttpClient().enqueueJson(200, { not_a_token: true })
    const auth = new OAuthClientCredentialsTokenManager(http, {
      tokenUrl: "https://wwwcie.ups.com/security/v1/oauth/token",
      clientId: "x",
      clientSecret: "y",
      carrier: "ups",
    })

    await expect(auth.getToken()).rejects.toMatchObject({
      name: "MalformedResponseError",
      code: "MALFORMED_RESPONSE",
      carrier: "ups",
    })
  })
})
