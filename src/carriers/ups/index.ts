/**
 * UPS carrier adapter.
 *
 * Wires together the HTTP client, OAuth token manager, and operations into
 * a single object that satisfies `Carrier`. Each operation is exposed as
 * an optional capability; unsupported ones simply aren't present.
 */

import { OAuthClientCredentialsTokenManager } from "../../core/auth/oauth-client-credentials"
import type { TokenManager } from "../../core/auth/token-manager"
import type { Carrier } from "../../core/carrier/carrier"
import { FetchHttpClient } from "../../core/http/fetch-client"
import type { HttpClient } from "../../core/http/client"
import type { UpsConfig } from "./config"
import { UpsRateOperation } from "./operations/rate"

export { UPS_DEFAULT_API_VERSION } from "./config"
export type { UpsConfig } from "./config"
export { UpsRateOperation } from "./operations/rate"

export interface UpsCarrierDependencies {
  /** Override the HTTP client (used by tests to stub the network). */
  http?: HttpClient
  /** Override the token manager (used by tests to inject fake tokens). */
  auth?: TokenManager
}

export class UpsCarrier implements Carrier {
  readonly name = "ups"
  readonly rate: UpsRateOperation

  constructor(config: UpsConfig, deps: UpsCarrierDependencies = {}) {
    const http =
      deps.http ?? new FetchHttpClient({ defaultTimeoutMs: config.timeoutMs })

    const auth =
      deps.auth ??
      new OAuthClientCredentialsTokenManager(http, {
        tokenUrl: `${stripTrailingSlash(config.baseUrl)}/security/v1/oauth/token`,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        carrier: "ups",
      })

    this.rate = new UpsRateOperation(http, auth, config)
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s
}
