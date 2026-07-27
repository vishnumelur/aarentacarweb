CREATE INDEX "bookings_expiry_idx" ON "bookings" USING btree ("expires_at") WHERE "bookings"."expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "totals_consistent" CHECK (
    "bookings"."total_fils" = "bookings"."subtotal_fils" - "bookings"."discount_fils" + "bookings"."vat_fils");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "self_drive_needs_vehicle" CHECK (
    "bookings"."product" <> 'self_drive' OR "bookings"."vehicle_id" IS NOT NULL);