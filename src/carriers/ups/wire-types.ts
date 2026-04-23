/**
 * Thin shapes for the subset of the UPS Rating API wire format we touch.
 *
 * These types are **internal** to the UPS adapter. The rest of the
 * codebase must never import them — it talks to UPS exclusively through
 * the normalized domain types in `src/core/types.ts`.
 *
 * Source: https://developer.ups.com/tag/Rating?loc=en_US (v2409)
 */

export interface UpsMonetary {
  CurrencyCode?: string
  MonetaryValue?: string
}

export interface UpsUnitOfMeasurement {
  Code?: string
  Description?: string
}

export interface UpsItemizedCharge extends UpsMonetary {
  Code?: string
  Description?: string
}

export interface UpsRatedShipment {
  Service?: { Code?: string; Description?: string }
  TotalCharges?: UpsMonetary
  TransportationCharges?: UpsMonetary
  ServiceOptionsCharges?: UpsMonetary
  ItemizedCharges?: UpsItemizedCharge | UpsItemizedCharge[]
  NegotiatedRateCharges?: { TotalCharge?: UpsMonetary }
  GuaranteedDelivery?: {
    BusinessDaysInTransit?: string
    DeliveryByTime?: string
  }
  TimeInTransit?: {
    ServiceSummary?: {
      EstimatedArrival?: {
        Arrival?: { Date?: string; Time?: string }
        BusinessDaysInTransit?: string
      }
    }
  }
}

export interface UpsRateResponseEnvelope {
  RateResponse?: {
    Response?: {
      ResponseStatus?: { Code?: string; Description?: string }
    }
    RatedShipment?: UpsRatedShipment | UpsRatedShipment[]
  }
}

export interface UpsErrorEnvelope {
  response?: {
    errors?: Array<{ code?: string; message?: string }>
  }
}
