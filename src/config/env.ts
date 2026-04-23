/**
 * Environment-variable configuration loader.
 *
 * - No secret ever comes from a source file — always from env.
 * - We use zod to fail fast with a clear message when something is wrong
 *   rather than letting a misconfiguration surface as an auth error at
 *   runtime.
 */

import { z } from "zod"
import type { UpsConfig } from "../carriers/ups/config"
import { UPS_DEFAULT_API_VERSION } from "../carriers/ups/config"

const UpsEnvSchema = z.object({
  UPS_BASE_URL: z
    .string()
    .url()
    .default("https://wwwcie.ups.com"),
  UPS_CLIENT_ID: z.string().min(1, "UPS_CLIENT_ID is required"),
  UPS_CLIENT_SECRET: z.string().min(1, "UPS_CLIENT_SECRET is required"),
  UPS_ACCOUNT_NUMBER: z.string().min(1).optional(),
  UPS_API_VERSION: z.string().min(1).default(UPS_DEFAULT_API_VERSION),
  UPS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
})

export type UpsEnv = z.infer<typeof UpsEnvSchema>

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigurationError"
  }
}

export function loadUpsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): UpsConfig {
  const parsed = UpsEnvSchema.safeParse(env)
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
    throw new ConfigurationError(`Invalid UPS configuration: ${msg}`)
  }
  const data = parsed.data
  return {
    baseUrl: data.UPS_BASE_URL,
    clientId: data.UPS_CLIENT_ID,
    clientSecret: data.UPS_CLIENT_SECRET,
    accountNumber: data.UPS_ACCOUNT_NUMBER,
    apiVersion: data.UPS_API_VERSION,
    timeoutMs: data.UPS_TIMEOUT_MS,
  }
}
