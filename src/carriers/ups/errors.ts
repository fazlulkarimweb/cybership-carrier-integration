/**
 * Translate UPS non-2xx responses into structured `CarrierError`s.
 */

import {
  AuthError,
  CarrierError,
  MalformedResponseError,
  RateLimitError,
} from "../../core/errors"
import type { HttpResponse } from "../../core/http/client"
import type { UpsErrorEnvelope } from "./wire-types"

const CARRIER = "ups"

export function mapUpsError(response: HttpResponse<unknown>): CarrierError {
  const status = response.status
  const body = response.body as UpsErrorEnvelope | undefined

  const rawErrors = body?.response?.errors ?? []
  const details = rawErrors
    .filter((e): e is { code?: string; message?: string } => typeof e === "object" && e !== null)
    .map((e) => ({ code: e.code, message: e.message }))

  const message =
    details[0]?.message ??
    truncate(response.rawBody) ??
    `UPS request failed with HTTP ${status}`

  if (status === 400 && details.length === 0 && !response.rawBody) {
    return new MalformedResponseError({
      message: "UPS returned 400 with no parseable error body",
      httpStatus: status,
      carrier: CARRIER,
    })
  }

  if (status === 401 || status === 403) {
    return new AuthError({
      message,
      httpStatus: status,
      carrier: CARRIER,
      details,
    })
  }

  if (status === 429) {
    const retryAfter = Number(response.headers["retry-after"])
    return new RateLimitError({
      message,
      httpStatus: status,
      carrier: CARRIER,
      details,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    })
  }

  if (status >= 500) {
    return new CarrierError({
      code: "CARRIER_ERROR",
      message,
      httpStatus: status,
      carrier: CARRIER,
      details,
      retryable: true,
    })
  }

  return new CarrierError({
    code: "CARRIER_ERROR",
    message,
    httpStatus: status,
    carrier: CARRIER,
    details,
  })
}

function truncate(s: string | undefined, max = 200): string | undefined {
  if (!s) return undefined
  return s.length > max ? `${s.slice(0, max)}…` : s
}
