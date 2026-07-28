-- users.branchId cannot carry a Drizzle .references() — fleet.ts imports identity.ts,
-- so the reverse import would be circular. The constraint belongs in the database
-- regardless: it is the only entity reference without referential integrity.
ALTER TABLE "users"
  ADD CONSTRAINT "users_branch_id_fk"
  FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id")
  ON DELETE restrict;
