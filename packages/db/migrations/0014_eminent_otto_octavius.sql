ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_documents" DROP CONSTRAINT "customer_documents_reviewed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_blacklisted_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "maintenance_jobs" DROP CONSTRAINT "maintenance_jobs_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_promo_code_id_promo_codes_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "self_drive_details" DROP CONSTRAINT "self_drive_details_pickup_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "self_drive_details" DROP CONSTRAINT "self_drive_details_return_branch_id_branches_id_fk";
--> statement-breakpoint
ALTER TABLE "damage_markers" DROP CONSTRAINT "damage_markers_photo_id_inspection_photos_id_fk";
--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_received_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "content_pages" DROP CONSTRAINT "content_pages_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_updated_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" SET DEFAULT next_invoice_number();--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_blacklisted_by_user_id_users_id_fk" FOREIGN KEY ("blacklisted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_drive_details" ADD CONSTRAINT "self_drive_details_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_drive_details" ADD CONSTRAINT "self_drive_details_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_photo_id_inspection_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_totals_consistent" CHECK ("invoices"."total_fils" = "invoices"."subtotal_fils" + "invoices"."vat_fils");