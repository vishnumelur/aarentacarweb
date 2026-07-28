ALTER TABLE "maintenance_jobs" DROP CONSTRAINT "maintenance_jobs_vehicle_id_vehicles_id_fk";
--> statement-breakpoint
ALTER TABLE "vehicle_documents" DROP CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk";
--> statement-breakpoint
ALTER TABLE "maintenance_jobs" ADD CONSTRAINT "maintenance_jobs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;