ALTER TABLE milestones ADD COLUMN kind TEXT NOT NULL DEFAULT 'milestone' CHECK (kind IN ('milestone','event'));
UPDATE milestones SET kind='milestone';
