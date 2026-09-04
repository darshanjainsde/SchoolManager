-- The admission-register facts a statutory Transfer Certificate prints
-- (CBSE Examination Bye-laws, Annexure-I: cbse.gov.in/Byelawsenglish.pdf).
-- All nullable; the certificate drawer asks once for what is blank and
-- saves it back. SchoolProfile gains the board + affiliation number the
-- Annexure head carries.
ALTER TABLE "Student"
  ADD COLUMN "fatherName" TEXT,
  ADD COLUMN "motherName" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "firstAdmissionDate" DATE,
  ADD COLUMN "firstAdmissionClass" TEXT,
  ADD COLUMN "previousSchool" TEXT,
  ADD COLUMN "penId" TEXT;

ALTER TABLE "SchoolProfile"
  ADD COLUMN "board" TEXT,
  ADD COLUMN "affiliationNo" TEXT;
