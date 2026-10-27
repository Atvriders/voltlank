// VoltLink drives, charging, and analytics types.

export interface DrivePoint {
  ts: string;
  lat: number;
  lon: number;
  speedKmh: number;
  headingDeg?: number;
  batteryPct?: number;
}

export interface Drive {
  id: string;
  vehicleId: string;
  vehicleName: string;
  startAt: string;
  endAt: string;
  startLat?: number;
  startLon?: number;
  startAddress?: string;
  endLat?: number;
  endLon?: number;
  endAddress?: string;
  distanceKm: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  energyKwh: number;
  efficiencyWhPerKm: number;
  estCost?: number;
  currency: string;
  elevationGainM?: number;
  avgOutsideTempC?: number;
  driverName?: string;
  tags: string[];
  classification: 'business' | 'personal' | 'unknown';
  notes?: string;
  route?: DrivePoint[];
}

export interface DriveTotals {
  count: number;
  distanceKm: number;
  energyKwh: number;
  cost: number;
  avgEfficiencyWhPerKm: number;
}

export interface ChargeSession {
  id: string;
  vehicleId: string;
  vehicleName: string;
  startAt: string;
  endAt?: string;
  locationName?: string;
  lat?: number;
  lon?: number;
  energyAddedKwh: number;
  batteryStartPct?: number;
  batteryEndPct?: number;
  durationSec: number;
  avgPowerKw: number;
  peakPowerKw: number;
  cost: number;
  currency: string;
  source: 'home' | 'work' | 'public' | 'fast' | 'other';
  idleTimeSec: number;
  estLossKwh: number;
  notes?: string;
  rateRuleId?: string;
  rateName?: string;
  pricePerKwh?: number;
  manualCost?: number | null;
}

export interface RatePeriod {
  startMin: number; // minutes from midnight
  endMin: number;
  pricePerKwh: number;
}

export interface RateRule {
  id: string;
  name: string;
  type: 'flat' | 'tou' | 'location';
  pricePerKwh: number;
  currency: string;
  periods: RatePeriod[];
  placeId?: string;
  enabled: boolean;
}

export interface DailyAggregate {
  date: string; // YYYY-MM-DD
  vehicleId: string;
  distanceKm: number;
  energyKwh: number;
  chargeEnergyKwh: number;
  chargeCost: number;
  driveCount: number;
  chargeSessionCount: number;
  minBatteryPct?: number;
  maxBatteryPct?: number;
}

export interface EfficiencyPoint {
  date: string;
  whPerKm: number;
  tempC?: number;
  distanceKm: number;
}

export interface BatteryPoint {
  ts: string;
  batteryPct: number;
  rangeKm?: number;
}

export interface BatteryHealth {
  estimatedUsableKwh: number;
  originalCapacityKwh: number;
  estimatedDegradationPct: number;
  sampleCount: number;
  firstSampleAt?: string;
  lastSampleAt?: string;
  disclaimer: string;
}
