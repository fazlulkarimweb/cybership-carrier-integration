/**
 * Keeps track of registered carriers so services (RatingService, future
 * LabelService, …) can look them up by name without knowing about concrete
 * classes.
 */

import { UnsupportedOperationError } from "../errors"
import type { Carrier, CarrierCapability } from "./carrier"
import { hasCapability } from "./carrier"

export class CarrierRegistry {
  private readonly carriers = new Map<string, Carrier>()

  register(carrier: Carrier): this {
    this.carriers.set(carrier.name.toLowerCase(), carrier)
    return this
  }

  unregister(name: string): boolean {
    return this.carriers.delete(name.toLowerCase())
  }

  get(name: string): Carrier {
    const c = this.carriers.get(name.toLowerCase())
    if (!c) {
      throw new UnsupportedOperationError(`Carrier "${name}" is not registered`)
    }
    return c
  }

  tryGet(name: string): Carrier | undefined {
    return this.carriers.get(name.toLowerCase())
  }

  has(name: string): boolean {
    return this.carriers.has(name.toLowerCase())
  }

  /** Names of every registered carrier, in insertion order. */
  list(): string[] {
    return [...this.carriers.keys()]
  }

  /** Names of carriers that implement the given capability. */
  listWithCapability(capability: CarrierCapability): string[] {
    return [...this.carriers.values()]
      .filter((c) => hasCapability(c, capability))
      .map((c) => c.name)
  }
}
