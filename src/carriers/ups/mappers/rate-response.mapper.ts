/**
 * UPS `RateResponse` wire payload → domain `RateQuote[]`.
 */

import { MalformedResponseError } from "../../../core/errors"
import type { MonetaryAmount, RateQuote, Surcharge } from "../../../core/types"
import { upsServiceName } from "../code-maps"
import type {
  UpsItemizedCharge,
  UpsMonetary,
  UpsRateResponseEnvelope,
  UpsRatedShipment,
} from "../wire-types"

const CARRIER = "ups"

export function parseUpsRateResponse(payload: UpsRateResponseEnvelope): RateQuote[] {
  const rateResponse = payload?.RateResponse
  if (!rateResponse) {
    throw new MalformedResponseError({
      message: "UPS response missing RateResponse envelope",
      carrier: CARRIER,
    })
  }

  const raw = rateResponse.RatedShipment
  if (raw === undefined || raw === null) {
    throw new MalformedResponseError({
      message: "UPS RateResponse missing RatedShipment",
      carrier: CARRIER,
    })
  }

  // UPS returns an object for single-service Rate calls and an array for Shop calls.
  const shipments = Array.isArray(raw) ? raw : [raw]
  return shipments.map(mapRatedShipment)
}

function mapRatedShipment(rs: UpsRatedShipment): RateQuote {
  const serviceCode = rs.Service?.Code
  if (!serviceCode) {
    throw new MalformedResponseError({
      message: "UPS RatedShipment missing Service.Code",
      carrier: CARRIER,
    })
  }

  // Prefer negotiated totals when UPS returns them, because that is what
  // the shipper is actually billed.
  const totalCharge =
    parseMoney(rs.NegotiatedRateCharges?.TotalCharge) ?? parseMoney(rs.TotalCharges)
  if (!totalCharge) {
    throw new MalformedResponseError({
      message: "UPS RatedShipment missing TotalCharges",
      carrier: CARRIER,
    })
  }

  const baseCharge = parseMoney(rs.TransportationCharges) ?? undefined

  const surcharges: Surcharge[] = []
  const serviceOptions = parseMoney(rs.ServiceOptionsCharges)
  if (serviceOptions && serviceOptions.amount > 0) {
    surcharges.push({
      code: "SERVICE_OPTIONS",
      description: "Service option charges",
      amount: serviceOptions,
    })
  }
  const itemized = rs.ItemizedCharges
  if (itemized) {
    const arr: UpsItemizedCharge[] = Array.isArray(itemized) ? itemized : [itemized]
    for (const item of arr) {
      const amt = parseMoney(item)
      if (amt) {
        surcharges.push({
          code: item.Code ?? "SURCHARGE",
          description: item.Description,
          amount: amt,
        })
      }
    }
  }

  const transitDaysStr =
    rs.GuaranteedDelivery?.BusinessDaysInTransit ??
    rs.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit
  const parsedDays = transitDaysStr !== undefined ? parseInt(transitDaysStr, 10) : NaN
  const transitDays = Number.isFinite(parsedDays) ? parsedDays : undefined

  const arrivalDate = rs.TimeInTransit?.ServiceSummary?.EstimatedArrival?.Arrival?.Date
  const estimatedDeliveryDate = arrivalDate ? normaliseUpsDate(arrivalDate) : undefined

  return {
    carrier: CARRIER,
    serviceCode,
    serviceName: upsServiceName(serviceCode),
    totalCharge,
    baseCharge,
    surcharges: surcharges.length > 0 ? surcharges : undefined,
    currency: totalCharge.currency,
    transitDays,
    estimatedDeliveryDate,
    guaranteed: Boolean(rs.GuaranteedDelivery),
    raw: rs,
  }
}

function parseMoney(node: UpsMonetary | undefined): MonetaryAmount | null {
  if (!node) return null
  const amount = Number(node.MonetaryValue)
  const currency = node.CurrencyCode
  if (!currency || !Number.isFinite(amount)) return null
  return { amount, currency }
}

/**
 * UPS returns dates as `YYYYMMDD`. Our domain uses ISO-8601 `YYYY-MM-DD`.
 */
function normaliseUpsDate(date: string): string {
  if (/^\d{8}$/.test(date)) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  }
  return date
}
