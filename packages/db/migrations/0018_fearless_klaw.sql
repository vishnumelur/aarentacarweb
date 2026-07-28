CREATE TABLE "phone_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempts_non_negative" CHECK ("phone_otps"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "phone_otps_phone_idx" ON "phone_otps" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "phone_otps_expiry_idx" ON "phone_otps" USING btree ("expires_at");