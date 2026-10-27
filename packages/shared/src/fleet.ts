// VoltLink fleet and status platform types.

export interface FleetGroup {
  id: string;
  name: string;
  description?: string;
  vehicleIds: string[];
}

export interface Department {
  id: string;
  name: string;
}

export interface CostCenter {
  id: string;
  name: string;
  code: string;
}

export interface Driver {
  id: string;
  userId?: string;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
}

export interface VehicleAssignment {
  id: string;
  vehicleId: string;
  driverId: string;
  driverName: string;
  departmentId?: string;
  costCenterId?: string;
  fromAt?: string;
  toAt?: string;
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  title: string;
  kind: 'service' | 'registration' | 'insurance' | 'tires' | 'inspection' | 'other';
  dueAt?: string;
  dueOdometerKm?: number;
  completedAt?: string;
  cost?: number;
  currency: string;
  notes?: string;
}

export interface FleetVehicleRow {
  vehicle: { id: string; name: string; vehicleClass: string };
  status: string;
  batteryPct?: number;
  charging: boolean;
  odometerKm?: number;
  driver?: string;
  department?: string;
  costCenter?: string;
  groupIds: string[];
  lastSeenAt?: string;
  attention: string[];
}

// ---- Status platform ----

export const COMPONENT_STATUSES = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export interface StatusComponent {
  id: string;
  key: string;
  name: string;
  group: string;
  description?: string;
  status: ComponentStatus;
  manualOverride: boolean;
  updatedAt: string;
  uptime90dPct: number;
}

export interface StatusCheckHistory {
  at: string;
  componentKey: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

export type IncidentPhase = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface IncidentUpdate {
  id: string;
  phase: IncidentPhase;
  message: string;
  createdAt: string;
  author: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: 'minor' | 'major' | 'critical' | 'maintenance';
  phases: Record<IncidentPhase, string | null>; // ISO or null
  status: IncidentPhase;
  components: string[];
  updates: IncidentUpdate[];
  public: boolean;
  createdAt: string;
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  components: string[];
  status: 'scheduled' | 'in_progress' | 'completed';
}

export interface PublicStatus {
  overall: ComponentStatus;
  components: StatusComponent[];
  incidents: Incident[];
  maintenance: MaintenanceWindow[];
  updatedAt: string;
  uptime30dPct: number;
}
