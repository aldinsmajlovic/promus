-- set when someone leaves or is removed; cleared by Undo. The row stays so history keeps their name
ALTER TABLE household_members ADD COLUMN removed_at INTEGER;
-- the owner, or the person themself for a leave: only a leave can be restored by the one who left
ALTER TABLE household_members ADD COLUMN removed_by TEXT REFERENCES users(id);
