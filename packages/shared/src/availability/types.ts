import type { ExistingBooking } from './overlap.js'
import type { OpeningInterval } from './opening-hours.js'

export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'retired'

export interface VehicleForAvailability {
  readonly id: string
  readonly status: VehicleStatus
  readonly branchId: string
}

export interface MaintenanceBlock {
  readonly id: string
  /** `YYYY-MM-DD`. */
  readonly startsOn: string
  /** `YYYY-MM-DD`, or null for an open-ended job. */
  readonly endsOn: string | null
}

export interface VehicleDocumentExpiry {
  readonly type: string
  /** `YYYY-MM-DD`. */
  readonly expiresOn: string
}

export type UnavailableReason =
  | { readonly kind: 'vehicle_status'; readonly status: VehicleStatus }
  | { readonly kind: 'booked'; readonly conflictingBookingIds: readonly string[] }
  | { readonly kind: 'maintenance'; readonly blockIds: readonly string[] }
  | { readonly kind: 'document_expired'; readonly documentType: string; readonly expiresOn: string }
  | { readonly kind: 'pickup_outside_hours' }
  | { readonly kind: 'return_outside_hours' }

export interface AvailabilityInput {
  readonly vehicle: VehicleForAvailability
  readonly startsAt: Date
  readonly endsAt: Date
  readonly existingBookings: readonly ExistingBooking[]
  readonly maintenanceBlocks: readonly MaintenanceBlock[]
  readonly documentExpiries: readonly VehicleDocumentExpiry[]
  readonly pickupBranchHours: readonly OpeningInterval[]
  readonly returnBranchHours: readonly OpeningInterval[]
}

export interface AvailabilityResult {
  readonly available: boolean
  readonly reasons: readonly UnavailableReason[]
}
