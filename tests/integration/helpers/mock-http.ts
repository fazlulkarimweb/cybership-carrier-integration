/**
 * Minimal stub `HttpClient` for integration tests.
 *
 * Queue responses (or `Error`s) in the order you expect requests to
 * arrive, then inspect `calls` afterwards to assert on the request that
 * reached the network boundary. This is the seam that lets us verify
 * request building, response parsing, and error handling end-to-end
 * without a live UPS endpoint.
 */

import type {
  HttpClient,
  HttpRequest,
  HttpResponse,
} from "../../../src/core/http/client"

export type QueuedResponse =
  | {
      status: number
      body?: unknown
      rawBody?: string
      headers?: Record<string, string>
    }
  | { throw: unknown }

export class MockHttpClient implements HttpClient {
  public readonly calls: HttpRequest[] = []
  private readonly queue: QueuedResponse[] = []

  /** Enqueue a canned response. */
  enqueue(response: QueuedResponse): this {
    this.queue.push(response)
    return this
  }

  /** Convenience: enqueue a 2xx JSON body. */
  enqueueJson(status: number, body: unknown, headers: Record<string, string> = {}): this {
    return this.enqueue({
      status,
      body,
      rawBody: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    })
  }

  /** Convenience: make the next call throw. */
  enqueueError(err: unknown): this {
    return this.enqueue({ throw: err })
  }

  get pending(): number {
    return this.queue.length
  }

  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    this.calls.push(req)
    const next = this.queue.shift()
    if (!next) {
      throw new Error(
        `MockHttpClient: no response queued for ${req.method} ${req.url}`,
      )
    }
    if ("throw" in next) {
      throw next.throw
    }
    return {
      status: next.status,
      headers: next.headers ?? {},
      body: next.body as T,
      rawBody: next.rawBody ?? (next.body !== undefined ? JSON.stringify(next.body) : ""),
    }
  }

  /** Find the first recorded call whose URL contains `needle`. */
  findCall(needle: string): HttpRequest | undefined {
    return this.calls.find((c) => c.url.includes(needle))
  }
}
