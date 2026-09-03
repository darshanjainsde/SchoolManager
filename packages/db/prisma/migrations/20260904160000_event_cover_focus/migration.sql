-- Which band of a tall cover photo the 16:9 tile keeps.
--
-- Additive and nullable: null means the middle, which is what a browser does
-- with object-fit:cover anyway, so every existing row is unchanged.
ALTER TABLE "Event" ADD COLUMN "coverFocus" TEXT;
