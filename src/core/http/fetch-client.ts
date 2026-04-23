/**
 * Default `HttpClient` implementation backed by the platform `fetch`.
 *
 * Responsibilities kept deliberately small:
 *  - enforce a request timeout via AbortController
 *  - translate low-level fetch/abort failures into `NetworkError`/`TimeoutError`
 *  - parse JSON when the server says it is JSON (and surface a
 *    `MalformedResponseError` when a 2xx response is not valid JSON)
 *
 * Higher-level concerns — auth, retries, mapping of carrier error codes —
 * live in the carrier adapters, not here.
 */

import {
  MalformedResponseError,
  NetworkError,
  TimeoutError,
} from "../errors"
import type { HttpClient, HttpRequest, HttpResponse } from "./client"

export interface FetchHttpClientOptions {
  /** Default request timeout in ms. Defaults to 15_000. */
  defaultTimeoutMs?: number
  /** Override fetch (tests can inject a stub; production uses `globalThis.fetch`). */
  fetchImpl?: typeof fetch
}

export class FetchHttpClient implements HttpClient {
  private readonly defaultTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: FetchHttpClientOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    // Merge caller-supplied abort signal with our timeout signal.
    if (req.signal) {
      if (req.signal.aborted) controller.abort()
      else
        req.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        })
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(req.headers ?? {}),
    }

    let body: string | undefined
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string") {
        body = req.body
      } else {
        body = JSON.stringify(req.body)
        if (!headerPresent(headers, "content-type")) {
          headers["Content-Type"] = "application/json"
        }
      }
    }

    // Race fetch against our abort signal so the request is guaranteed to
    // terminate even if an underlying fetch implementation fails to honour
    // AbortController (e.g. misbehaving polyfills or test stubs).
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"))
        return
      }
      controller.signal.addEventListener(
        "abort",
        () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        { once: true },
      )
    })

    let response: Response
    try {
      response = await Promise.race([
        this.fetchImpl(req.url, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
        }),
        abortPromise,
      ])
    } catch (err) {
      clearTimeout(timer)
      if (timedOut || isAbortError(err)) {
        throw new TimeoutError({
          message: `Request to ${req.url} timed out after ${timeoutMs}ms`,
          cause: err,
        })
      }
      throw new NetworkError({
        message: `Network error calling ${req.url}: ${
          (err as Error)?.message ?? "unknown"
        }`,
        cause: err,
      })
    } finally {
      clearTimeout(timer)
    }

    const rawBody = await response.text()
    const headersOut: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      headersOut[k.toLowerCase()] = v
    })

    let parsed: unknown = undefined
    if (rawBody.length > 0) {
      const contentType = headersOut["content-type"] ?? ""
      const looksJson =
        contentType.includes("application/json") || contentType.includes("+json")
      if (looksJson) {
        try {
          parsed = JSON.parse(rawBody)
        } catch (err) {
          if (response.ok) {
            throw new MalformedResponseError({
              message: `Malformed JSON response from ${req.url}`,
              httpStatus: response.status,
              cause: err,
            })
          }
          // non-2xx with bad JSON: leave parsed undefined, rawBody is still available
        }
      } else {
        // Try JSON opportunistically — some servers forget the header.
        try {
          parsed = JSON.parse(rawBody)
        } catch {
          /* not JSON; that's fine */
        }
      }
    }

    return {
      status: response.status,
      headers: headersOut,
      body: parsed as T,
      rawBody,
    }
  }
}

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  )
}

function headerPresent(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return true
  }
  return false
}
