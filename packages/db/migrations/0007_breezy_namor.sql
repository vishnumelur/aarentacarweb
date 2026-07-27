CREATE TYPE "public"."damage_severity" AS ENUM('scratch', 'dent', 'crack', 'missing');--> statement-breakpoint
CREATE TYPE "public"."handover_kind" AS ENUM('pickup', 'return');--> statement-breakpoint
CREATE TABLE "damage_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"panel" text NOT NULL,
	"x_percent" integer NOT NULL,
	"y_percent" integer NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"notes" text,
	"photo_id" uuid,
	CONSTRAINT "x_percent_range" CHECK ("damage_markers"."x_percent" BETWEEN 0 AND 100),
	CONSTRAINT "y_percent_range" CHECK ("damage_markers"."y_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "handover_kind" NOT NULL,
	"odometer_km" integer NOT NULL,
	"fuel_level_eighths" integer NOT NULL,
	"checklist" text,
	"notes" text,
	"conducted_by_user_id" uuid NOT NULL,
	"signature_object_key" text,
	"signature_ip_address" text,
	"terms_version" text,
	"contract_object_key" text,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_eighths_range" CHECK ("handovers"."fuel_level_eighths" BETWEEN 0 AND 8),
	CONSTRAINT "odometer_non_negative" CHECK ("handovers"."odometer_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"angle" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_photo_id_inspection_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_conducted_by_user_id_users_id_fk" FOREIGN KEY ("conducted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "damage_markers_handover_idx" ON "damage_markers" USING btree ("handover_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handover_active_unique" ON "handovers" USING btree ("booking_id","kind") WHERE "handovers"."superseded_by_id" IS NULL;--> statement-breakpoint
CREATE INDEX "inspection_photos_handover_idx" ON "inspection_photos" USING btree ("handover_id");