# Tesla setup (official Fleet API)

VoltLink's primary real-vehicle provider is Tesla's official Fleet API.

## 1. Register an application

1. Go to <https://developer.tesla.com> and sign in with your Tesla account.
2. Create an application. Choose the access scope you need (vehicle data,
   commands, telemetry). VoltLink uses:
   - `vehicle_device_data` (state)
   - `vehicle_cmds` (commands)
   - `vehicle_charging_cmds` (charging controls)
   - `vehicle_location` (location)
3. Set the redirect URI to:

   ```
   https://<your-voltlink-host>/api/v1/providers/tesla/callback
   ```

4. Copy the client ID and secret.

## 2. Configure VoltLink

In `.env` (or the runtime environment):

```bash
TESLA_CLIENT_ID=<client id>
TESLA_CLIENT_SECRET=<client secret>
TESLA_REDIRECT_URI=https://<your-voltlink-host>/api/v1/providers/tesla/callback
```

`TESLA_BASE_URL` defaults to the North America fleet API endpoint; set it to
your region's endpoint if Tesla provisioned a different one for your
application.

## 3. Connect in the UI

**Providers → Tesla → Connect** redirects you to Tesla. Authorize, and VoltLink
exchanges the code for tokens and stores them encrypted (see
[Providers](PROVIDERS.md#credential-security)). Then **Import vehicles**.

## 4. Commands & readiness

Each command definition declares the capability it requires, and the provider
maps commands to Fleet API endpoints with pre-flight readiness checks (e.g.
`charge_start` requires the cable to be plugged). Dispatch results are mapped
into VoltLink's command lifecycle — `submitted` when Tesla accepts the command,
`accepted`/`confirmed` from telemetry observation, and `rejected`/`unsupported`
when Tesla refuses it.

## Notes

- Sleep-aware polling: when the vehicle is asleep the poller backs off to the
  expected wake time; `remote_start` and `wake` exist to wake it.
- High-risk commands require step-up authentication (re-enter password or use
  a passkey). See [Vehicle controls](VEHICLE_CONTROLS.md).
- If your application is not yet in Tesla's production tier, some endpoints
  return `unsupported` — the command lifecycle records that outcome precisely.
