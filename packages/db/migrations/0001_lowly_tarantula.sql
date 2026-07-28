CREATE TYPE "public"."maintenance_status" AS ENUM('open', 'in_progress', 'closed');--> statement-breakpoint
CREATE TYPE "public"."vehicle_document_type" AS ENUM('mulkiya', 'insurance', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'rented', 'maintenance', 'retired');--> statement-breakpoint
CREATE TABLE "branch_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "weekday_range" CHECK ("branch_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "opens_before_closes" CHECK ("branch_hours"."opens_at" < "branch_hours"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address_line" text NOT NULL,
	"city" text DEFAULT 'Dubai' NOT NULL,
	"phone" text NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"delivery_fee_fils" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "maintenance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"status" "maintenance_status" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"cost_fils" integer DEFAULT 0 NOT NULL,
	"odometer_km" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vehicle_classes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"type" "vehicle_document_type" NOT NULL,
	"document_number" text,
	"expires_on" date NOT NULL,
	"object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_document_unique" UNIQUE("vehicle_id","type")
);
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration" text NOT NULL,
	"vin" text,
	"class_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"colour" text NOT NULL,
	"transmission" text DEFAULT 'automatic' NOT NULL,
	"seats" integer DEFAULT 5 NOT NULL,
	"odometer_km" integer DEFAULT 0 NOT NULL,
	"acquisition_cost_fils" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_registration_unique" UNIQUE("registration"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "year_sane" CHECK ("vehicles"."year" BETWEEN 1990 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_class_id_vehicle_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."vehicle_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_hours_branch_idx" ON "branch_hours" USING btree ("branch_id","weekday");--> statement-breakpoint
CREATE INDEX "maintenance_vehicle_status_idx" ON "maintenance_jobs" USING btree ("vehicle_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_documents_expiry_idx" ON "vehicle_documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "vehicle_photos_vehicle_idx" ON "vehicle_photos" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicles_class_idx" ON "vehicles" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_status_idx" ON "vehicles" USING btree ("branch_id","status");