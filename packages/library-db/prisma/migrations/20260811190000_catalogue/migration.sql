-- CreateEnum
CREATE TYPE "AuthorRole" AS ENUM ('AUTHOR', 'EDITOR', 'TRANSLATOR');

-- CreateEnum
CREATE TYPE "CopyCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'ON_HOLD_SHELF', 'IN_TRANSIT', 'LOST', 'DAMAGED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Title" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "isbn13" TEXT,
    "isbn10" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "edition" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "callNumber" TEXT,
    "coverUrl" TEXT,
    "description" TEXT,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortName" TEXT NOT NULL,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleAuthor" (
    "titleId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "role" "AuthorRole" NOT NULL DEFAULT 'AUTHOR',

    CONSTRAINT "TitleAuthor_pkey" PRIMARY KEY ("titleId","authorId","role")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleCategory" (
    "titleId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "TitleCategory_pkey" PRIMARY KEY ("titleId","categoryId")
);

-- CreateTable
CREATE TABLE "Copy" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "accessionNumber" TEXT,
    "shelf" TEXT,
    "condition" "CopyCondition" NOT NULL DEFAULT 'GOOD',
    "acquiredAt" TIMESTAMP(3),
    "acquisitionCost" DECIMAL(10,2),
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Copy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Title_orgId_idx" ON "Title"("orgId");

-- CreateIndex
CREATE INDEX "Title_orgId_callNumber_idx" ON "Title"("orgId", "callNumber");

-- CreateIndex
CREATE INDEX "Author_orgId_idx" ON "Author"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Author_orgId_sortName_key" ON "Author"("orgId", "sortName");

-- CreateIndex
CREATE INDEX "TitleAuthor_authorId_idx" ON "TitleAuthor"("authorId");

-- CreateIndex
CREATE INDEX "Category_orgId_idx" ON "Category"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_orgId_name_key" ON "Category"("orgId", "name");

-- CreateIndex
CREATE INDEX "TitleCategory_categoryId_idx" ON "TitleCategory"("categoryId");

-- CreateIndex
CREATE INDEX "Copy_titleId_status_idx" ON "Copy"("titleId", "status");

-- CreateIndex
CREATE INDEX "Copy_orgId_branchId_status_idx" ON "Copy"("orgId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Copy_orgId_barcode_key" ON "Copy"("orgId", "barcode");

-- AddForeignKey
ALTER TABLE "Title" ADD CONSTRAINT "Title_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Author" ADD CONSTRAINT "Author_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleAuthor" ADD CONSTRAINT "TitleAuthor_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleAuthor" ADD CONSTRAINT "TitleAuthor_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleCategory" ADD CONSTRAINT "TitleCategory_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleCategory" ADD CONSTRAINT "TitleCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Copy" ADD CONSTRAINT "Copy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Copy" ADD CONSTRAINT "Copy_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Copy" ADD CONSTRAINT "Copy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Full-text search. A generated column keeps the vector in lockstep with the
-- row automatically, so no trigger and no application code can forget it.
-- GIN over tsvector is correct well past 1M titles per org; an external search
-- engine is never needed at school scale.
ALTER TABLE "Title"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("subtitle", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("publisher", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("callNumber", '')), 'C')
  ) STORED;

CREATE INDEX "title_search" ON "Title" USING GIN ("searchVector");
CREATE UNIQUE INDEX "title_isbn13_per_org" ON "Title" ("orgId", "isbn13") WHERE "isbn13" IS NOT NULL;
