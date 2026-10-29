# review-pls

## Docker

The image is built from `Dockerfile` (Next.js standalone output) and is intended to run behind a reverse proxy that terminates TLS.

1. Create the bind-mounted database directory. The container runs as uid/gid `1000` (`node`), so the host directory must be writable by that user:

   ```bash
   mkdir -p data
   sudo chown -R 1000:1000 data
   ```

2. Set the environment variables in `docker-compose.yml`
3. Start it:
   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```

On every start the container runs pending Drizzle migrations before accepting requests (see `src/instrumentation.ts`), so upgrades just need a rebuild and restart. The SQLite database lives on the `./data` bind mount, including its `-wal`/`-shm` files, so use a local filesystem (not NFS/SMB).

The app listens on port `3000` inside the container. `docker-compose.yml` publishes it on `127.0.0.1:3000` only; point the reverse proxy at that address and forward the `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

## Published images

`.github/workflows/docker.yml` builds and pushes the image to GHCR on every push to `main`, on `v*` tags, and on manual dispatch:

```bash
docker pull ghcr.io/404simon/review-pls:latest
```

Tags are `latest` (default branch), the branch name, `sha-<commit>`, and `X.Y.Z` / `X.Y` for version tags. Builds use BuildKit's GitHub Actions cache (`mode=max`), so the dependency install and build stages are reused between runs.
