ALTER TABLE "Explanation"
ADD COLUMN "shareId" TEXT;

CREATE UNIQUE INDEX "Explanation_shareId_key" ON "Explanation"("shareId");

CREATE TABLE "PublicComment" (
  "id" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "explanationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PublicComment"
ADD CONSTRAINT "PublicComment_explanationId_fkey"
FOREIGN KEY ("explanationId") REFERENCES "Explanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
