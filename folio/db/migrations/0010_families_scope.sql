CREATE INDEX "investors_family_idx" ON "investors" USING btree ("family_id");--> statement-breakpoint

-- Families: a sub-broker (limited member) sees only families that hold at least one of their own clients.
-- The subquery on investors is itself filtered by its policy (migration 0003). Anyone in the practice may
-- start a family (it holds nobody yet, so the insert can't be checked against members); only owners and
-- staff may delete one, because deleting also ungroups clients a sub-broker can't see.
DROP POLICY families_practice ON families;
--> statement-breakpoint
CREATE POLICY families_read ON families FOR SELECT TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR id IN (SELECT family_id FROM investors)));
--> statement-breakpoint
CREATE POLICY families_insert ON families FOR INSERT TO folio_app
  WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY families_update ON families FOR UPDATE TO folio_app
  USING (practice_id = app_practice_id() AND (NOT app_limited() OR id IN (SELECT family_id FROM investors)))
  WITH CHECK (practice_id = app_practice_id());
--> statement-breakpoint
CREATE POLICY families_delete ON families FOR DELETE TO folio_app
  USING (practice_id = app_practice_id() AND NOT app_limited());
