ALTER TABLE "broadcasts" ALTER COLUMN "audience" SET DEFAULT '{"listIds":[],"segmentIds":[],"excludeListIds":[],"excludeSegmentIds":[]}'::jsonb;--> statement-breakpoint
UPDATE "broadcasts" SET "audience" = "audience" || '{"excludeSegmentIds": []}'::jsonb WHERE NOT ("audience" ? 'excludeSegmentIds');
