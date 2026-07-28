CREATE TYPE "public"."addon_price_model" AS ENUM('per_day', 'per_booking');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_fils" integer NOT NULL,
	"price_model" "addon_price_model" NOT NULL,
	"stock_limit" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "addons_slug_unique" UNIQUE("slug"),
	CONSTRAINT "addon_price_non_negative" CHECK ("addons"."price_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"min_booking_value_fils" integer DEFAULT 0 NOT NULL,
	"total_usage_cap" integer,
	"per_customer_cap" integer DEFAULT 1 NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "promo_range_ordered" CHECK ("promo_codes"."valid_to" >= "promo_codes"."valid_from"),
	CONSTRAINT "discount_value_positive" CHECK ("promo_codes"."discount_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"monthly_rate_fils" integer,
	"deposit_fils" integer NOT NULL,
	"included_km_per_day" integer NOT NULL,
	"excess_km_rate_fils" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_rate_non_negative" CHECK ("rate_cards"."daily_rate_fils" >= 0),
	CONSTRAINT "deposit_non_negative" CHECK ("rate_cards"."deposit_fils" >= 0),
	CONSTRAINT "validity_ordered" CHECK ("rate_cards"."valid_to" IS NULL OR "rate_cards"."valid_to" >= "rate_cards"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "seasonal_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"multiplier_bps" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "range_ordered" CHECK ("seasonal_rates"."ends_on" >= "seasonal_rates"."starts_on"),
	CONSTRAINT "multiplier_positive" CHECK ("seasonal_rates"."multiplier_bps" > 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"min_days" integer NOT NULL,
	"discount_bps" integer NOT NULL,
	CONSTRAINT "min_days_positive" CHECK ("weekly_tiers"."min_days" > 0),
	CONSTRAINT "discount_bps_range" CHECK ("weekly_tiers"."discount_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_class_id_vehicle_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."vehicle_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_class_id_vehicle_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."vehicle_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_tiers" ADD CONSTRAINT "weekly_tiers_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_cards_class_validity_idx" ON "rate_cards" USING btree ("class_id","valid_from");--> statement-breakpoint
CREATE INDEX "seasonal_rates_class_range_idx" ON "seasonal_rates" USING btree ("class_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "weekly_tiers_card_idx" ON "weekly_tiers" USING btree ("rate_card_id","min_days");