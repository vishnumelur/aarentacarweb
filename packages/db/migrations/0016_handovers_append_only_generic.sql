-- 0008 enumerated handover columns literally in handovers_append_only(), so any column
-- added later would be silently mutable — the trigger simply wouldn't know to guard it.
-- Replace the function body with a structural comparison that covers every column
-- automatically. Do not edit 0008 itself: it has already been applied.
CREATE OR REPLACE FUNCTION handovers_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'handovers are append-only: supersede the record, never delete it';
  END IF;
  IF to_jsonb(NEW) - 'superseded_by_id' IS DISTINCT FROM to_jsonb(OLD) - 'superseded_by_id' THEN
    RAISE EXCEPTION 'handovers are append-only: only superseded_by_id may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
