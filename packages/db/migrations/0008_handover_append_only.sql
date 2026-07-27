-- NFR-11 Evidentiary integrity. Handover records and inspection photographs are the
-- evidence that decides damage disputes. Comments do not enforce that; these do.

-- Self-reference must be DEFERRABLE: superseding is UPDATE-old-then-INSERT-new within
-- one transaction, so the target row does not exist when the UPDATE runs.
ALTER TABLE "handovers"
  ADD CONSTRAINT "handovers_superseded_by_id_fk"
  FOREIGN KEY ("superseded_by_id") REFERENCES "public"."handovers"("id")
  ON DELETE restrict
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION handovers_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'handovers are append-only: supersede the record, never delete it';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.odometer_km IS DISTINCT FROM OLD.odometer_km
     OR NEW.fuel_level_eighths IS DISTINCT FROM OLD.fuel_level_eighths
     OR NEW.checklist IS DISTINCT FROM OLD.checklist
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.conducted_by_user_id IS DISTINCT FROM OLD.conducted_by_user_id
     OR NEW.signature_object_key IS DISTINCT FROM OLD.signature_object_key
     OR NEW.signature_ip_address IS DISTINCT FROM OLD.signature_ip_address
     OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.contract_object_key IS DISTINCT FROM OLD.contract_object_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'handovers are append-only: only superseded_by_id may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER handovers_append_only_trg
  BEFORE UPDATE OR DELETE ON "handovers"
  FOR EACH ROW EXECUTE FUNCTION handovers_append_only();
--> statement-breakpoint

-- Photographs are the evidence itself. Immutable, and the capture timestamp is the
-- server's, never the client's.
CREATE OR REPLACE FUNCTION inspection_photos_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.captured_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'inspection photographs are immutable evidence: they may not be % ',
    lower(TG_OP);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER inspection_photos_force_captured_at
  BEFORE INSERT ON "inspection_photos"
  FOR EACH ROW EXECUTE FUNCTION inspection_photos_immutable();
--> statement-breakpoint

CREATE TRIGGER inspection_photos_immutable_trg
  BEFORE UPDATE OR DELETE ON "inspection_photos"
  FOR EACH ROW EXECUTE FUNCTION inspection_photos_immutable();
