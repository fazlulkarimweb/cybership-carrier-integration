/**
 * Generic OAuth 2.0 `client_credentials` token manager.
 *
 * Used by the UPS adapter and by any future carrier that uses the same
 * grant type (FedEx, DHL). Carrier-specific quirks (extra headers, form
 * fields, token URL) are supplied via configuration so the implementation
 * itself stays carrier-agnostic.
 *
 * Guarantees:
 *  - Tokens are cached in-memory and reused until `clockSkewMs` before they
 *    expire.
 *  - Concurrent `getToken()` calls coalesce into a single network request.
 *  - Structured `AuthError`/`MalformedResponseError` on failure.
 */

import { AuthError, MalformedResponseError } from "../errors"
import type { HttpClient } from "../http/client"
import type { AuthToken, TokenManager } from "./token-manager"

export interface OAuthClientCredentialsConfig {
  /** Full URL to the OAuth 2.0 token endpoint. */
  tokenUrl: string
  clientId: string
  clientSecret: string
  /** OAuth scope, if the carrier requires one. */
  scope?: string
  /**
   * How many ms before nominal expiry we consider the token stale. Default
   * 60_000 (1 minute). This hides clock skew between our host and the
   * carrier and avoids a race where a request starts with a token that
   * expires mid-flight.
   */
  clockSkewMs?: number
  /** Additional form fields (e.g. `audience`, `resource`). */
  extraFormFields?: Record<string, string>
  /** Additional request headers (e.g. UPS `x-merchant-id`). */
  extraHeaders?: Record<string, string>
  /** Carrier name used for tagging errors. */
  carrier?: string
}

interface RawTokenPayload {
  access_token?: unknown
  token_type?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

export class OAuthClientCredentialsTokenManager implements TokenManager {
  private cached: AuthToken | null = null
  private inflight: Promise<AuthToken> | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly config: OAuthClientCredentialsConfig,
  ) {}

  async getToken(): Promise<AuthToken> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached
    }
    // Coalesce concurrent refreshes.
    if (this.inflight) return this.inflight

    this.inflight = this.fetchToken().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  invalidate(): void {
    this.cached = null
  }

  private async fetchToken(): Promise<AuthToken> {
    const {
      tokenUrl,
      clientId,
      clientSecret,
      scope,
      extraFormFields,
      extraHeaders,
      clockSkewMs = 60_000,
      carrier,
    } = this.config

    const params = new URLSearchParams({ grant_type: "client_credentials" })
    if (scope) params.set("scope", scope)
    if (extraFormFields) {
      for (const [k, v] of Object.entries(extraFormFields)) params.set(k, v)
    }

    // RFC 6749 §2.3.1: clients SHOULD authenticate via HTTP Basic.
    const basic = base64(`${clientId}:${clientSecret}`)

    const response = await this.http.request<RawTokenPayload>({
      method: "POST",
      url: tokenUrl,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(extraHeaders ?? {}),
      },
      // `string` body is passed through as-is by FetchHttpClient so the
      // content-type stays `x-www-form-urlencoded`.
      body: params.toString(),
    })

    if (response.status < 200 || response.status >= 300) {
      const payload = response.body ?? {}
      const description =
        typeof payload.error_description === "string" ? payload.error_description : undefined
      const error = typeof payload.error === "string" ? payload.error : undefined
      throw new AuthError({
        message: `OAuth token request failed (${response.status}): ${description ?? error ?? truncate(response.rawBody) ?? "unknown error"}`,
        httpStatus: response.status,
        carrier,
        retryable: response.status >= 500 || response.status === 429,
        details: error ? [{ code: error, message: description }] : [],
      })
    }

    const payload = response.body
    if (!payload || typeof payload.access_token !== "string") {
      throw new MalformedResponseError({
        message: "OAuth token response did not contain an access_token",
        httpStatus: response.status,
        carrier,
      })
    }

    const expiresInSec =
      typeof payload.expires_in === "number"
        ? payload.expires_in
        : typeof payload.expires_in === "string"
          ? Number(payload.expires_in)
          : NaN
    const ttlMs = (Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 3600) * 1000

    const token: AuthToken = {
      accessToken: payload.access_token,
      tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
      // Ensure we refresh at least a second before expiry even if ttl <= skew.
      expiresAt: Date.now() + Math.max(ttlMs - clockSkewMs, 1_000),
    }

    this.cached = token
    return token
  }
}

function base64(input: string): string {
  // Prefer Buffer in Node, fall back to btoa in edge/browser runtimes.
  if (typeof Buffer !== "undefined") return Buffer.from(input, "utf8").toString("base64")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).btoa(input)
}

function truncate(s: string | undefined, max = 200): string | undefined {
  if (!s) return undefined
  return s.length > max ? `${s.slice(0, max)}…` : s
}
