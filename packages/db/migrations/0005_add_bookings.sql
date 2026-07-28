CREATE TYPE "public"."booking_product" AS ENUM('self_drive', 'lease', 'chauffeur_hourly', 'chauffeur_transfer');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP', 'OUT', 'RETURNED', 'CLOSING', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED');--> statement-breakpoint
CREATE TABLE "booking_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"total_price_fils" integer NOT NULL,
	CONSTRAINT "booking_addon_unique" UNIQUE("booking_id","addon_id"),
	CONSTRAINT "quantity_positive" CHECK ("booking_addons"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"product" "booking_product" NOT NULL,
	"status" "booking_status" DEFAULT 'DRAFT' NOT NULL,
	"vehicle_id" uuid,
	"rate_card_id" uuid NOT NULL,
	"promo_code_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"discount_fils" integer DEFAULT 0 NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"terms_version" text,
	"cancellation_policy" text,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "range_ordered" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "totals_non_negative" CHECK (
    "bookings"."subtotal_fils" >= 0 AND "bookings"."vat_fils" >= 0
    AND "bookings"."total_fils" >= 0 AND "bookings"."deposit_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "self_drive_details" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"included_km_total" integer NOT NULL,
	"delivery_address" text,
	"delivery_fee_fils" integer DEFAULT 0 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_drive_details" ADD CONSTRAINT "self_drive_details_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_drive_details" ADD CONSTRAINT "self_drive_details_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_drive_details" ADD CONSTRAINT "self_drive_details_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_status_start_idx" ON "bookings" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_vehicle_range_idx" ON "bookings" USING btree ("vehicle_id","starts_at","ends_at");