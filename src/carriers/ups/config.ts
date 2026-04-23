/**
 * UPS adapter configuration.
 *
 * Values come from the environment via `src/config/env.ts` in production;
 * in tests we construct these objects directly.
 */

export interface UpsConfig {
  /**
   * Base URL for the UPS API.
   *  - Sandbox (CIE): https://wwwcie.ups.com
   *  - Production:    https://onlinetools.ups.com
   */
  baseUrl: string
  clientId: string
  clientSecret: string
  /** Required by UPS for real rate requests (the shipper's UPS account number). */
  accountNumber?: string
  /**
   * API version segment — UPS versions its endpoints (e.g. `v2409` for
   * September 2024). Kept configurable so we can upgrade without a code
   * change.
   */
  apiVersion?: string
  /** Per-request timeout in ms. */
  timeoutMs?: number
}

export const UPS_DEFAULT_API_VERSION = "v2409"
