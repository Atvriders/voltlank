# Status platform

VoltLink ships a complete public status platform: uptime, incidents,
maintenance windows, subscriber notifications, RSS and an SVG badge.

## Public page

`/status` (no login required) shows:

- 16 platform components (API, Web, Worker, Scheduler, Database, Queue,
  Telemetry ingestion, Provider connectivity, Command dispatch, Status site,
  …) with health from scheduled checks
- Current incidents (with severity, status and updates)
- Upcoming maintenance windows
- 90-day uptime percentage per component and per day

## Administration

The **Status admin** page (owner/admin roles):

- Override any component (operational / degraded / outage / maintenance)
- Create and update incidents, post incident updates
- Schedule maintenance windows
- Configure what each component checks (HTTP endpoints, DB/queue probes)

## Subscribers & formats

- **Subscribe** (email) to receive incident and maintenance notifications.
- **RSS** at `/status/rss`.
- **SVG badge** at `/status/badge.svg` — embed in your README or dashboard:

  ```markdown
  ![status](https://<your-host>/status/badge.svg)
  ```

## Automation integration

The `create_incident` automation action opens incidents from vehicle events,
so a fleet-wide charging failure can surface on the public status page
automatically.
