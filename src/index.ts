/**
 * Public entry point for the Cybership carrier integration module.
 *
 * Importers should pull everything they need from here — not from
 * internal paths — so the internal module layout stays free to evolve.
 */

// Domain
export * from "./core/types"
export * from "./core/errors"
export {
  AddressSchema,
  DimensionsSchema,
  MonetaryAmountSchema,
  PackageSchema,
  RateRequestSchema,
  WeightSchema,
  zodIssuesToDetails,
} from "./core/schemas"

// Transport & auth primitives
export type { HttpClient, HttpRequest, HttpResponse, HttpMethod } from "./core/http/client"
export { FetchHttpClient } from "./core/http/fetch-client"
export type { FetchHttpClientOptions } from "./core/http/fetch-client"
export type { AuthToken, TokenManager } from "./core/auth/token-manager"
export {
  OAuthClientCredentialsTokenManager,
} from "./core/auth/oauth-client-credentials"
export type { OAuthClientCredentialsConfig } from "./core/auth/oauth-client-credentials"

// Carrier contract
export type { Carrier, CarrierCapability } from "./core/carrier/carrier"
export { hasCapability } from "./core/carrier/carrier"
export type {
  AddressValidationOperation,
  LabelPurchaseOperation,
  RateOperation,
  TrackingOperation,
} from "./core/carrier/operations"
export { CarrierRegistry } from "./core/carrier/registry"

// Services
export { RatingService } from "./services/rating-service"
export type { RateShoppingOptions, RateShoppingResult } from "./services/rating-service"

// UPS adapter
export { UpsCarrier, UPS_DEFAULT_API_VERSION } from "./carriers/ups"
export type { UpsConfig, UpsCarrierDependencies } from "./carriers/ups"

// Configuration
export { loadUpsConfigFromEnv, ConfigurationError } from "./config/env"
export type { UpsEnv } from "./config/env"
