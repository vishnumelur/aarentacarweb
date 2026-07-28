CREATE TYPE "public"."charge_type" AS ENUM('salik', 'fine', 'damage', 'late', 'fuel', 'cleaning', 'excess_km');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('held', 'released', 'captured', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'paid', 'void', 'credited');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'cash', 'bnpl');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" charge_type NOT NULL,
	"amount_fils" integer NOT NULL,
	"admin_fee_fils" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"evidence_object_key" text,
	"occurred_at" timestamp with time zone,
	"is_disputed" boolean DEFAULT false NOT NULL,
	"is_settled" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_amount_non_negative" CHECK ("charges"."amount_fils" >= 0 AND "charges"."admin_fee_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"status" "deposit_status" DEFAULT 'held' NOT NULL,
	"amount_fils" integer NOT NULL,
	"captured_fils" integer DEFAULT 0 NOT NULL,
	"gateway_reference" text,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "deposit_holds_gateway_reference_unique" UNIQUE("gateway_reference"),
	CONSTRAINT "hold_amount_positive" CHECK ("deposit_holds"."amount_fils" > 0),
	CONSTRAINT "capture_within_hold" CHECK ("deposit_holds"."captured_fils" BETWEEN 0 AND "deposit_holds"."amount_fils")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "invoices_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"credits_invoice_id" uuid,
	"void_reason" text,
	"pdf_object_key" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoice_totals_non_negative" CHECK (
    "invoices"."subtotal_fils" >= 0 AND "invoices"."vat_fils" >= 0 AND "invoices"."total_fils" >= 0),
	CONSTRAINT "void_requires_reason" CHECK ("invoices"."status" <> 'void' OR "invoices"."void_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_fils" integer NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"gateway_reference" text,
	"gateway_name" text,
	"received_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_gateway_reference_unique" UNIQUE("gateway_reference"),
	CONSTRAINT "amount_positive" CHECK ("payments"."amount_fils" > 0),
	CONSTRAINT "refund_within_amount" CHECK ("payments"."refunded_fils" BETWEEN 0 AND "payments"."amount_fils")
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_holds" ADD CONSTRAINT "deposit_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_booking_idx" ON "charges" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "deposit_holds_booking_idx" ON "deposit_holds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");