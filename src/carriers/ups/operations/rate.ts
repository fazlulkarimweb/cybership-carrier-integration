/**
 * UPS implementation of the `RateOperation` capability.
 *
 * Flow:
 *   1. Validate the domain request.
 *   2. Build the UPS wire payload via the request mapper.
 *   3. Acquire an OAuth token (cached/refreshed transparently).
 *   4. POST to `/api/rating/{version}/{Rate|Shop}`.
 *   5. On 401, invalidate the token and retry once.
 *   6. Map errors to structured `CarrierError`s, parse success responses
 *      to `RateQuote[]`.
 */

import type { TokenManager } from "../../../core/auth/token-manager"
import type { RateOperation } from "../../../core/carrier/operations"
import {
  MalformedResponseError,
  ValidationError,
} from "../../../core/errors"
import type { HttpClient } from "../../../core/http/client"
import { RateRequestSchema, zodIssuesToDetails } from "../../../core/schemas"
import type { RateQuote, RateRequest } from "../../../core/types"
import type { UpsConfig } from "../config"
import { UPS_DEFAULT_API_VERSION } from "../config"
import { mapUpsError } from "../errors"
import { buildUpsRateRequest } from "../mappers/rate-request.mapper"
import { parseUpsRateResponse } from "../mappers/rate-response.mapper"
import type { UpsRateResponseEnvelope } from "../wire-types"

const CARRIER = "ups"

export class UpsRateOperation implements RateOperation {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: TokenManager,
    private readonly config: UpsConfig,
  ) {}

  async execute(request: RateRequest): Promise<RateQuote[]> {
    // 1. Validate before any network call.
    const parsed = RateRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid rate request",
        zodIssuesToDetails(parsed.error),
        CARRIER,
      )
    }
    const validated = parsed.data as RateRequest

    // 2. Build the wire payload.
    const upsBody = buildUpsRateRequest(validated, {
      accountNumber: this.config.accountNumber,
    })

    // UPS distinguishes "Rate" (single service) from "Shop" (all eligible services).
    const requestOption = validated.serviceCode ? "Rate" : "Shop"
    const version = this.config.apiVersion ?? UPS_DEFAULT_API_VERSION
    const url = `${stripTrailingSlash(this.config.baseUrl)}/api/rating/${version}/${requestOption}`

    // 3-5. Call UPS, transparently refreshing the token on 401.
    const response = await this.callWithTokenRefresh(url, upsBody)

    if (response.status < 200 || response.status >= 300) {
      throw mapUpsError(response)
    }

    const body = response.body as UpsRateResponseEnvelope | undefined
    if (!body || typeof body !== "object") {
      throw new MalformedResponseError({
        message: "UPS rate response body was empty or not JSON",
        httpStatus: response.status,
        carrier: CARRIER,
      })
    }

    // 6. Normalize.
    return parseUpsRateResponse(body)
  }

  private async callWithTokenRefresh(url: string, body: unknown) {
    const doCall = async () => {
      const token = await this.auth.getToken()
      return this.http.request({
        method: "POST",
        url,
        headers: {
          Authorization: `${token.tokenType} ${token.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          // UPS recommends a unique transaction id per request for support
          // lookups. Safe to send even when they don't require it.
          transId: generateTransactionId(),
          transactionSrc: "cybership-carrier-integration",
        },
        body,
        timeoutMs: this.config.timeoutMs,
      })
    }

    const response = await doCall()
    if (response.status !== 401) return response

    // Token may have been revoked or invalidated server-side despite being
    // within its TTL. Drop the cache and try exactly once more.
    this.auth.invalidate()
    return doCall()
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s
}

function generateTransactionId(): string {
  // crypto.randomUUID is present in Node 19+ and all modern browsers/edge runtimes.
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // Fallback — good enough for a request-correlation id.
  return `cs-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
