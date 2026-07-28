-- FR-15.2 — invoice numbers must be sequential and gapless under UAE tax law.
-- A Postgres identity column cannot deliver this: sequences are non-transactional, so a
-- rolled-back insert burns a number forever. A counter row advanced inside the caller's
-- own transaction rolls back with it. This serialises invoice creation, which is correct
-- and irrelevant at this volume.

CREATE TABLE "invoice_sequence" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "next_number" integer NOT NULL DEFAULT 1,
  CONSTRAINT "invoice_sequence_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint

INSERT INTO "invoice_sequence" ("id", "next_number") VALUES (1, 1);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION next_invoice_number() RETURNS integer AS $$
DECLARE allocated integer;
BEGIN
  -- The UPDATE takes a row lock held to end of transaction. Concurrent callers queue;
  -- a rollback returns the number to the pool.
  UPDATE "invoice_sequence"
     SET "next_number" = "next_number" + 1
   WHERE "id" = 1
  RETURNING "next_number" - 1 INTO allocated;
  RETURN allocated;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

ALTER TABLE "invoices" ALTER COLUMN "number" DROP IDENTITY IF EXISTS;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" SET DEFAULT next_invoice_number();
--> statement-breakpoint

-- FR-15.2 — rows are never deleted. A void keeps its number and is marked void.
CREATE OR REPLACE FUNCTION invoices_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoices are never deleted: void the invoice, keeping its number';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER invoices_no_delete_trg
  BEFORE DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_no_delete();
--> statement-breakpoint

-- Same defect class as Task 8's supersededById: a bare uuid that could point anywhere.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_credits_invoice_id_fk"
  FOREIGN KEY ("credits_invoice_id") REFERENCES "public"."invoices"("id")
  ON DELETE restrict;
