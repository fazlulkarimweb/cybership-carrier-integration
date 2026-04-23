/**
 * Structured error hierarchy.
 *
 * Every failure mode in the system — validation, network, auth, rate-limit,
 * malformed response, unsupported capability — is represented by a subclass
 * of `CarrierError`. This gives callers a consistent, serialisable error
 * contract that does not leak HTTP or carrier-specific details unless they
 * want them.
 */

export type CarrierErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CARRIER_ERROR"
  | "MALFORMED_RESPONSE"
  | "UNSUPPORTED_OPERATION"
  | "UNKNOWN"

export interface CarrierErrorDetail {
  /** Carrier-specific error code, if any. */
  code?: string
  message?: string
  /** JSON-path-like pointer to a field that failed validation. */
  field?: string
}

export interface CarrierErrorOptions {
  code: CarrierErrorCode
  message: string
  carrier?: string
  httpStatus?: number
  retryable?: boolean
  details?: CarrierErrorDetail[]
  cause?: unknown
}

export class CarrierError extends Error {
  public readonly code: CarrierErrorCode
  public readonly carrier?: string
  public readonly httpStatus?: number
  public readonly retryable: boolean
  public readonly details: CarrierErrorDetail[]
  public override readonly cause?: unknown

  constructor(opts: CarrierErrorOptions) {
    super(opts.message)
    this.name = "CarrierError"
    this.code = opts.code
    this.carrier = opts.carrier
    this.httpStatus = opts.httpStatus
    this.retryable = opts.retryable ?? false
    this.details = opts.details ?? []
    this.cause = opts.cause
  }

  /** JSON-safe representation suitable for logs and API responses. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      carrier: this.carrier,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

export class ValidationError extends CarrierError {
  constructor(
    message: string,
    details: CarrierErrorDetail[] = [],
    carrier?: string,
  ) {
    super({ code: "VALIDATION_ERROR", message, details, carrier })
    this.name = "ValidationError"
  }
}

export class AuthError extends CarrierError {
  constructor(opts: Omit<CarrierErrorOptions, "code"> & { code?: CarrierErrorCode }) {
    super({ ...opts, code: opts.code ?? "AUTH_ERROR" })
    this.name = "AuthError"
  }
}

export class RateLimitError extends CarrierError {
  /** Seconds until the caller should retry, if the carrier provided it. */
  public readonly retryAfterSeconds?: number

  constructor(opts: Omit<CarrierErrorOptions, "code"> & { retryAfterSeconds?: number }) {
    super({ ...opts, code: "RATE_LIMITED", retryable: opts.retryable ?? true })
    this.name = "RateLimitError"
    this.retryAfterSeconds = opts.retryAfterSeconds
  }

  override toJSON(): Record<string, unknown> {
    return { ...super.toJSON(), retryAfterSeconds: this.retryAfterSeconds }
  }
}

export class TimeoutError extends CarrierError {
  constructor(opts: Omit<CarrierErrorOptions, "code">) {
    super({ ...opts, code: "TIMEOUT", retryable: opts.retryable ?? true })
    this.name = "TimeoutError"
  }
}

export class NetworkError extends CarrierError {
  constructor(opts: Omit<CarrierErrorOptions, "code">) {
    super({ ...opts, code: "NETWORK_ERROR", retryable: opts.retryable ?? true })
    this.name = "NetworkError"
  }
}

export class MalformedResponseError extends CarrierError {
  constructor(opts: Omit<CarrierErrorOptions, "code">) {
    super({ ...opts, code: "MALFORMED_RESPONSE" })
    this.name = "MalformedResponseError"
  }
}

export class UnsupportedOperationError extends CarrierError {
  constructor(message: string, carrier?: string) {
    super({ code: "UNSUPPORTED_OPERATION", message, carrier })
    this.name = "UnsupportedOperationError"
  }
}
