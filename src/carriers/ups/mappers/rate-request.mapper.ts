/**
 * Domain `RateRequest` → UPS `RateRequest` wire payload.
 *
 * All knowledge of UPS field names lives here. If UPS renames anything in
 * a future API version, this is the only file that should need to change.
 */

import type { Address, Package as DomainPackage, RateRequest } from "../../../core/types"
import { UPS_PACKAGING_CODE, UPS_PICKUP_CODE } from "../code-maps"

export interface BuildUpsRateRequestOptions {
  /** UPS shipper account number. Required by UPS for negotiated rates. */
  accountNumber?: string
  /** Custom `CustomerContext` passed through on the response for tracing. */
  customerContext?: string
}

export function buildUpsRateRequest(
  req: RateRequest,
  opts: BuildUpsRateRequestOptions = {},
): Record<string, unknown> {
  return {
    RateRequest: {
      Request: {
        TransactionReference: {
          CustomerContext: opts.customerContext ?? "Rate Shopping",
        },
      },
      Shipment: {
        Shipper: buildShipperAddress(req.shipper, opts.accountNumber),
        ShipTo: buildAddressNode(req.recipient),
        ShipFrom: buildAddressNode(req.shipper),
        ...(req.serviceCode ? { Service: { Code: req.serviceCode } } : {}),
        ...(req.pickupType ? { PickupType: { Code: UPS_PICKUP_CODE[req.pickupType] } } : {}),
        ...(req.rateType === "NEGOTIATED"
          ? { ShipmentRatingOptions: { NegotiatedRatesIndicator: "" } }
          : {}),
        ...(req.shipDate
          ? {
              DeliveryTimeInformation: {
                PackageBillType: "03",
                Pickup: { Date: req.shipDate.replace(/-/g, "") },
              },
            }
          : {}),
        Package: req.packages.map(buildPackageNode),
      },
    },
  }
}

function buildShipperAddress(a: Address, accountNumber?: string): Record<string, unknown> {
  const node = buildAddressNode(a)
  if (accountNumber) {
    node.ShipperNumber = accountNumber
  }
  return node
}

function buildAddressNode(a: Address): Record<string, unknown> {
  const addressLines = [a.street1]
  if (a.street2) addressLines.push(a.street2)

  const node: Record<string, unknown> = {
    Name: a.company ?? a.name ?? "",
    Address: {
      AddressLine: addressLines,
      City: a.city,
      StateProvinceCode: a.stateOrProvince,
      PostalCode: a.postalCode.replace(/\s+/g, ""),
      CountryCode: a.countryCode,
      // UPS uses an empty string for boolean "indicator" flags. Presence,
      // not value, means "true".
      ...(a.residential ? { ResidentialAddressIndicator: "" } : {}),
    },
  }
  if (a.name && a.company) node.AttentionName = a.name
  if (a.phone) node.Phone = { Number: a.phone }
  return node
}

function buildPackageNode(p: DomainPackage): Record<string, unknown> {
  const weightCode = p.weight.unit === "kg" ? "KGS" : "LBS"
  const packaging = UPS_PACKAGING_CODE[p.packagingType ?? "BOX"]

  const node: Record<string, unknown> = {
    PackagingType: { Code: packaging },
    PackageWeight: {
      UnitOfMeasurement: { Code: weightCode },
      Weight: formatNumber(p.weight.value),
    },
  }

  if (p.dimensions) {
    node.Dimensions = {
      UnitOfMeasurement: { Code: p.dimensions.unit === "cm" ? "CM" : "IN" },
      Length: formatNumber(p.dimensions.length),
      Width: formatNumber(p.dimensions.width),
      Height: formatNumber(p.dimensions.height),
    }
  }

  if (p.declaredValue) {
    node.PackageServiceOptions = {
      DeclaredValue: {
        CurrencyCode: p.declaredValue.currency,
        MonetaryValue: formatNumber(p.declaredValue.amount),
      },
    }
  }

  return node
}

/**
 * UPS wants numbers as strings. We trim trailing zeros so "5" stays "5"
 * rather than "5.00" — UPS accepts either but the shorter form matches
 * the examples in the docs.
 */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(2)))
}
