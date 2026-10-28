# Automations

Automations react to vehicle and platform events: **trigger → conditions →
actions**, with cooldowns, dry-run and full execution history.

## Anatomy

```
Automation
├── trigger        one of 12 trigger events
├── conditions     optional filters (battery below X%, outside geofence, time…)
├── actions        one or more: notify / webhook / create incident /
│                  generate report / vehicle command
├── cooldown       minimum seconds between runs (default 300)
└── enabled        on/off, plus dry-run for testing
```

## Trigger events

`charge_started`, `charge_completed`, `drive_started`, `drive_completed`,
`battery_low`, `battery_high`, `geofence_enter`, `geofence_exit`,
`vehicle_offline`, `vehicle_online`, `command_finished`, `maintenance_due`.

## Conditions

- Battery state-of-charge below / above a threshold
- Inside or outside a chosen geofence
- Time of day window
- Vehicle filter (all / one vehicle / a fleet group)

## Actions

| Action | Effect |
| --- | --- |
| Notify | Notification through the user's preferred channels |
| Webhook | `POST` JSON payload to a chosen webhook endpoint |
| Create incident | Opens a status-page incident with the payload |
| Generate report | Queues a fleet or vehicle report generation |
| Vehicle command | Issues a command through the normal lifecycle (step-up still applies to high-risk commands) |

## Testing

Every automation supports **dry-run**: pick a recent event and VoltLink
evaluates trigger, conditions and actions without executing writes, showing
exactly what *would* have happened.

The **executions** panel records each real run: timestamps, matched conditions,
per-action outcomes, and errors.

## Examples

- *"If battery falls below 20% and it's after 22:00, notify me"*
- *"When the pickup exits the jobsite geofence, create an incident and notify
  the fleet group"*
- *"On charge completed, generate a charging behaviour report"*

## Webhook payload

Webhook actions deliver a signed JSON body (trigger, vehicle, event data,
timestamp) to your endpoint. An optional `X-VoltLink-Signature` header uses
HMAC-SHA256 so receivers can verify the call.
