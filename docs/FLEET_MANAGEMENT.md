# Fleet management

The Fleet page organizes many vehicles into an accountable structure.

## Model

```
FleetGroup ──< Vehicle (many)
Driver ──< Assignment >── Vehicle   (with dates)
Department ──< Vehicle
CostCenter ──< Vehicle
Vehicle ──< MaintenanceRecord
```

- **Groups** — e.g. "Sales fleet", "Service loaners". Vehicles can move
  between groups; a group summary shows state, charge and activity across its
  members.
- **Drivers** — people with contact details; assign a driver to a vehicle for
  a date range (assignments are historical).
- **Departments / cost centers** — reporting dimensions that roll up into the
  fleet report.

## Maintenance

Maintenance records attach to vehicles: type (tires, service, inspection…),
odometer at service, cost, due date, notes. A `maintenance_due` automation
trigger exists for reminders, and the fleet report surfaces overdue items.

## Fleet report

A generated report covering the selected group/period:

- Vehicles, utilization (drives, distance), charging totals and cost
- Battery health snapshot
- Maintenance status (overdue / upcoming)
- Command activity summary

Downloadable as JSON and printable in the UI.

## Permissions

Fleet data respects roles: owners and admins manage structure; operators can
view; viewers see the overview only. Vehicle-level permissions (owner /
granted roles) still apply to sensitive live state and commands.
