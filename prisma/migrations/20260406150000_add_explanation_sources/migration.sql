CREATE TABLE "ExplanationSource" (
  "id" TEXT NOT NULL,
  "citationIndex" INTEGER NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "snippet" TEXT NOT NULL,
  "explanationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExplanationSource_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExplanationSource"
ADD CONSTRAINT "ExplanationSource_explanationId_fkey"
FOREIGN KEY ("explanationId") REFERENCES "Explanation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ExplanationSource_explanationId_idx" ON "ExplanationSource"("explanationId");
