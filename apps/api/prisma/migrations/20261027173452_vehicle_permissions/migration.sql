-- CreateTable
CREATE TABLE "VehiclePermission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehiclePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehiclePermission_userId_idx" ON "VehiclePermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePermission_vehicleId_userId_key" ON "VehiclePermission"("vehicleId", "userId");

-- AddForeignKey
ALTER TABLE "VehiclePermission" ADD CONSTRAINT "VehiclePermission_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

