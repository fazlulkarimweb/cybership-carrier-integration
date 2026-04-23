/**
 * Transport abstraction.
 *
 * Everything in the integration layer talks to carriers through this
 * interface — never `fetch` directly. That is what makes it trivial to
 * stub the HTTP layer in tests and to swap in an instrumented client
 * (retries, circuit breaker, tracing) without touching carrier code.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface HttpRequest {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  /**
   * Request body. Objects are JSON-encoded with `application/json`; strings
   * are sent as-is (useful for `application/x-www-form-urlencoded` OAuth
   * token requests).
   */
  body?: unknown
  /** Overrides the client default. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HttpResponse<T = unknown> {
  status: number
  /** Lower-cased header names. */
  headers: Record<string, string>
  /** Parsed JSON body, or `undefined` if the body was empty or not JSON. */
  body: T
  /** Raw response text, always present — helpful when the body is not JSON. */
  rawBody: string
}

export interface HttpClient {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>
}
