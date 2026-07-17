-- Admin-selectable navbar bar colour (PAPER | WHITE | DARK | BRAND).
ALTER TABLE "SchoolProfile" ADD COLUMN "navColor" TEXT NOT NULL DEFAULT 'PAPER';
