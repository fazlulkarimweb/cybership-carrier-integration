/**
 * Auth abstraction. Carrier operations ask a `TokenManager` for a valid
 * token each time they build a request and never concern themselves with
 * acquisition, caching, or refresh.
 */

export interface AuthToken {
  accessToken: string
  /** e.g. "Bearer". */
  tokenType: string
  /** Absolute epoch milliseconds after which the token must be refreshed. */
  expiresAt: number
}

export interface TokenManager {
  /**
   * Returns a valid, unexpired token. Implementations MUST coalesce
   * concurrent refreshes so N parallel callers do not trigger N token
   * requests.
   */
  getToken(): Promise<AuthToken>

  /**
   * Drop any cached token. Carrier operations call this when the carrier
   * returns 401, so the next request acquires a fresh token.
   */
  invalidate(): void
}
