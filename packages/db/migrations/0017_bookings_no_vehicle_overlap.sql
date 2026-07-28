CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- A vehicle cannot be out on two active bookings at once. The availability engine (P1.2)
-- is the primary guard; this is the backstop for when it has a bug.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_vehicle_overlap"
  EXCLUDE USING gist (
    "vehicle_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("vehicle_id" IS NOT NULL
       AND "status" IN ('CONFIRMED','DOCS_VERIFIED','READY_FOR_PICKUP','OUT'));
