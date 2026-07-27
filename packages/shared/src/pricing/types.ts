import { z } from 'zod'

export const BOOKING_PRODUCTS = [
  'self_drive', 'lease', 'chauffeur_hourly', 'chauffeur_transfer',
] as const
export type BookingProduct = (typeof BOOKING_PRODUCTS)[number]

export const AddonSchema = z.object({
  id: z.string(),
  slug: z.string(),
  priceFils: z.number().int().nonnegative(),
  priceModel: z.enum(['per_day', 'per_booking']),
  quantity: z.number().int().positive(),
})
export type Addon = z.infer<typeof AddonSchema>

export const PromoCodeSchema = z.object({
  code: z.string(),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().int().positive(),
  /** NULL means every product. Values come from BOOKING_PRODUCTS. */
  applicableProducts: z.array(z.string()).nullable(),
  minBookingValueFils: z.number().int().nonnegative(),
})
export type PromoCode = z.infer<typeof PromoCodeSchema>

export type PromoRejectedReason =
  | 'below_minimum_value'
  | 'product_not_applicable'

export interface QuoteLine {
  readonly label: string
  readonly amountFils: number
}
