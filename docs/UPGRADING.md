# Upgrading

## Production (published image)

```bash
docker compose -f compose.production.yml pull
docker compose -f compose.production.yml up -d
```

- Back up first (see Backup & restore) — cheap insurance.
- Migrations apply automatically on boot under an advisory lock; multiple
  replicas racing is safe.
- Roll back by pinning the previous tag:

  ```bash
  VOLTLANK_IMAGE_TAG=<previous-tag> docker compose -f compose.production.yml up -d
  ```

  Roll forward-only schema migrations may reject older images — check
  `CHANGELOG.md` for migration notes before downgrading.

## Development compose

```bash
docker compose up -d --build
```

## Version policy

- `latest` tracks `main`.
- `v1.0.0` and future tags are stable releases.
- Commit-SHA tags exist for every push: pin those for auditable rollbacks.
- Breaking changes and migration notes appear in `CHANGELOG.md`.

## Multi-replica upgrades

Upgrade `web` and `worker` together when the changelog says a queue-payload or
SSE contract changed; otherwise rolling upgrades are fine.
