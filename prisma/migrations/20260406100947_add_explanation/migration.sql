-- CreateTable
CREATE TABLE "Explanation" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Explanation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Explanation" ADD CONSTRAINT "Explanation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
