/**
 * High-level rate-shopping service.
 *
 * Given a validated `RateRequest`, fan out to every registered carrier
 * that supports rating and return the merged list of quotes. Errors from
 * individual carriers are either surfaced (strict mode, default) or
 * collected alongside partial results (allowPartial mode).
 */

import type { Carrier } from "../core/carrier/carrier"
import type { CarrierRegistry } from "../core/carrier/registry"
import {
  CarrierError,
  UnsupportedOperationError,
  ValidationError,
} from "../core/errors"
import { RateRequestSchema, zodIssuesToDetails } from "../core/schemas"
import type { RateQuote, RateRequest } from "../core/types"

export interface RateShoppingOptions {
  /**
   * Limit the shop to a specific set of carriers (by name). If omitted,
   * every registered carrier with a `rate` capability is asked.
   */
  carriers?: string[]
  /**
   * When true, errors from individual carriers are collected in the
   * `errors` array instead of being thrown. Useful when a client would
   * rather show "3 of 4 carriers returned rates" than fail the whole
   * request.
   *
   * Default: `false`.
   */
  allowPartial?: boolean
}

export interface RateShoppingResult {
  quotes: RateQuote[]
  errors: Array<{ carrier: string; error: CarrierError }>
}

export class RatingService {
  constructor(private readonly registry: CarrierRegistry) {}

  async rate(
    request: RateRequest,
    options: RateShoppingOptions = {},
  ): Promise<RateShoppingResult> {
    // Validate at the service boundary — carrier adapters also validate,
    // but doing it here gives a single, deterministic failure point
    // before we fan out and means we never send garbage to *any* carrier.
    const parsed = RateRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw new ValidationError(
        "Invalid rate request",
        zodIssuesToDetails(parsed.error),
      )
    }
    const validated = parsed.data as RateRequest

    const names = options.carriers ?? this.registry.listWithCapability("rate")
    if (names.length === 0) {
      throw new UnsupportedOperationError(
        "No carriers with a rate capability are registered",
      )
    }

    const carriers: Array<{ name: string; carrier: Carrier }> = names.map((name) => ({
      name,
      carrier: this.registry.get(name),
    }))

    // Fan out in parallel. `allSettled` lets us collect successes and
    // failures independently rather than letting one carrier's outage
    // fail the whole shop.
    const settled = await Promise.allSettled(
      carriers.map(async ({ name, carrier }) => {
        if (!carrier.rate) {
          throw new UnsupportedOperationError(
            `Carrier "${name}" does not support rating`,
            name,
          )
        }
        return { name, quotes: await carrier.rate.execute(validated) }
      }),
    )

    const quotes: RateQuote[] = []
    const errors: RateShoppingResult["errors"] = []

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]
      const carrierName = carriers[i].name
      if (result.status === "fulfilled") {
        quotes.push(...result.value.quotes)
      } else {
        errors.push({ carrier: carrierName, error: normaliseError(result.reason, carrierName) })
      }
    }

    // Strict mode (default): any carrier failure surfaces as a thrown
    // error. Callers who would rather see partial results opt into
    // `allowPartial` and inspect the `errors` array themselves.
    if (!options.allowPartial && errors.length > 0) {
      throw errors[0].error
    }

    return { quotes, errors }
  }
}

function normaliseError(reason: unknown, carrierName: string): CarrierError {
  if (reason instanceof CarrierError) {
    return reason
  }
  const err = reason as Error | undefined
  return new CarrierError({
    code: "UNKNOWN",
    message: err?.message ?? "Unknown error",
    carrier: carrierName,
    cause: reason,
  })
}
