# Operations Runbook — AA Rent A Car

Companion to [`../superpowers/specs/2026-07-27-aa-rentacar-design.md`](../superpowers/specs/2026-07-27-aa-rentacar-design.md).
That document says *what* to build; this one says *how to run it*.

Target host: the existing `Hetzner-PVE` Proxmox node (`10.10.10.1`), fronted by the existing
`caddy` container (LXC 100, `10.10.10.2`), backed up by `PBS-Local` (`10.10.10.200:8007`).

> Written to be executed by an operator or an AI assistant with root on the Proxmox node.
> Commands assume Proxmox VE 8.x and Debian 12 LXC templates.

---

## 0. Before you start

Confirm the node can actually take this workload. The spec requires **~6 cores, 16 GB RAM and
350 GB free NVMe** on top of existing containers.

```bash
# on the Proxmox node
nproc                          # physical cores
free -g                        # total and available RAM
pvesm status                   # storage pools and free space
pct list                       # existing containers and their state
```

If free RAM is under 16 GB, stop and reduce the deployment (see §11 Constrained node) rather
than overcommitting — a Postgres OOM-kill takes the whole business offline.

### IP plan

Existing addresses in use: `.1` PVE · `.2` caddy · `.200` pbs · `.201` monitoring · `.202` panel.

| Container | CTID | IP | Role |
|---|---|---|---|
| `aa-postgres` | 210 | `10.10.10.21` | Database |
| `aa-redis` | 211 | `10.10.10.22` | Cache, queue, sessions |
| `aa-minio` | 212 | `10.10.10.23` | Object storage |
| `aa-web` | 213 | `10.10.10.24` | Next.js application |
| `aa-worker` | 214 | `10.10.10.25` | Background jobs |

**No container except `aa-web` is exposed to the internet.** Everything else is reachable only
on `10.10.10.0/24`. Caddy is the only public entry point.

---

## 1. Provision the containers

Download a template if not already present:

```bash
pveam update
pveam available | grep debian-12
pveam download local debian-12-standard_12.7-1_amd64.tar.zst
```

Create each container. Adjust `local-lvm` to your actual storage pool from `pvesm status`.

```bash
# --- aa-postgres (CTID 210) ---
pct create 210 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname aa-postgres \
  --cores 2 --memory 4096 --swap 1024 \
  --rootfs local-lvm:60 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.10.21/24,gw=10.10.10.1 \
  --features nesting=1 \
  --onboot 1 --start 1

# --- aa-redis (CTID 211) ---
pct create 211 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname aa-redis \
  --cores 1 --memory 1024 --swap 512 \
  --rootfs local-lvm:10 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.10.22/24,gw=10.10.10.1 \
  --onboot 1 --start 1

# --- aa-minio (CTID 212) ---
pct create 212 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname aa-minio \
  --cores 1 --memory 2048 --swap 512 \
  --rootfs local-lvm:250 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.10.23/24,gw=10.10.10.1 \
  --onboot 1 --start 1

# --- aa-web (CTID 213) — needs nesting for Docker ---
pct create 213 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname aa-web \
  --cores 4 --memory 6144 --swap 2048 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.10.24/24,gw=10.10.10.1 \
  --features nesting=1,keyctl=1 \
  --onboot 1 --start 1

# --- aa-worker (CTID 214) ---
pct create 214 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname aa-worker \
  --cores 1 --memory 1536 --swap 512 \
  --rootfs local-lvm:10 \
  --net0 name=eth0,bridge=vmbr0,ip=10.10.10.25/24,gw=10.10.10.1 \
  --features nesting=1,keyctl=1 \
  --onboot 1 --start 1
```

`nesting=1` is required for Docker inside an unprivileged LXC. Enter any container with
`pct enter <CTID>`.

---

## 2. Postgres (CTID 210)

```bash
pct enter 210
apt update && apt upgrade -y
apt install -y postgresql-17 postgresql-contrib
# If 17 is not in Debian 12 repos, add PGDG:
#   apt install -y curl ca-certificates
#   install -d /usr/share/postgresql-common/pgdg
#   curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
#        https://www.postgresql.org/media/keys/ACCC4CF8.asc
#   echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
#        https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
#        > /etc/apt/sources.list.d/pgdg.list
#   apt update && apt install -y postgresql-17
```

Create the database and role. **Generate a strong password; do not reuse one.**

```bash
su - postgres -c "psql -c \"CREATE ROLE aarental LOGIN PASSWORD '<STRONG_PASSWORD>';\""
su - postgres -c "psql -c \"CREATE DATABASE aarental OWNER aarental ENCODING 'UTF8' LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8' TEMPLATE template0;\""
```

Tuning for 4 GB RAM — edit `/etc/postgresql/17/main/postgresql.conf`:

```conf
listen_addresses = '10.10.10.21'
max_connections = 100
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
work_mem = 8MB
wal_buffers = 16MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1          # NVMe, not spinning disk
effective_io_concurrency = 200
timezone = 'UTC'                # store UTC, render Asia/Dubai in the app
log_min_duration_statement = 500  # log anything slower than 500ms
```

Restrict access — edit `/etc/postgresql/17/main/pg_hba.conf`, add:

```
host  aarental  aarental  10.10.10.24/32  scram-sha-256   # aa-web
host  aarental  aarental  10.10.10.25/32  scram-sha-256   # aa-worker
```

```bash
systemctl restart postgresql
systemctl enable postgresql
```

Verify from `aa-web`: `pct enter 213 && apt install -y postgresql-client && psql -h 10.10.10.21 -U aarental -d aarental -c '\l'`

---

## 3. Redis (CTID 211)

```bash
pct enter 211
apt update && apt install -y redis-server
```

Edit `/etc/redis/redis.conf`:

```conf
bind 10.10.10.22
protected-mode yes
requirepass <STRONG_PASSWORD>
maxmemory 768mb
maxmemory-policy allkeys-lru
appendonly yes                  # BullMQ jobs must survive a restart
appendfsync everysec
```

```bash
systemctl restart redis-server && systemctl enable redis-server
```

> `maxmemory-policy allkeys-lru` evicts under pressure. Queue jobs live in the AOF, so an
> eviction loses cache, not work.

---

## 4. MinIO (CTID 212)

```bash
pct enter 212
apt update && apt install -y wget
wget https://dl.min.io/server/minio/release/linux-amd64/minio -O /usr/local/bin/minio
chmod +x /usr/local/bin/minio
useradd -r minio-user -s /sbin/nologin
mkdir -p /data/minio && chown minio-user:minio-user /data/minio
```

`/etc/default/minio`:

```bash
MINIO_VOLUMES="/data/minio"
MINIO_OPTS="--address 10.10.10.23:9000 --console-address 10.10.10.23:9001"
MINIO_ROOT_USER=<ADMIN_USER>
MINIO_ROOT_PASSWORD=<STRONG_PASSWORD>
```

`/etc/systemd/system/minio.service`:

```ini
[Unit]
Description=MinIO
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now minio
```

### Buckets

Install the client, then create buckets. **All four are private** — access is exclusively via
signed, expiring URLs generated by the application.

```bash
wget https://dl.min.io/client/mc/release/linux-amd64/mc -O /usr/local/bin/mc && chmod +x /usr/local/bin/mc
mc alias set local http://10.10.10.23:9000 <ADMIN_USER> <STRONG_PASSWORD>

mc mb local/aa-kyc            # Emirates ID, passport, visa, licence
mc mb local/aa-inspections    # handover photos — the volume driver
mc mb local/aa-contracts      # signed rental agreement PDFs
mc mb local/aa-vehicles       # marketing photography (public-readable)

mc anonymous set none     local/aa-kyc
mc anonymous set none     local/aa-inspections
mc anonymous set none     local/aa-contracts
mc anonymous set download local/aa-vehicles
```

Versioning on the buckets that hold dispute evidence — an overwritten inspection photo is
unrecoverable otherwise:

```bash
mc version enable local/aa-inspections
mc version enable local/aa-contracts
mc version enable local/aa-kyc
```

Lifecycle — inspection photos accumulate at ~10 MB/booking (spec §3). Transition old objects
rather than deleting them; UAE disputes surface late.

```bash
mc ilm rule add --expire-delete-marker --noncurrent-expire-days 90 local/aa-inspections
```

Create a service account for the application rather than handing it root credentials:

```bash
mc admin user svcacct add local <ADMIN_USER>
# record the generated access key and secret -> S3_ACCESS_KEY / S3_SECRET_KEY
```

---

## 5. Application container (CTID 213)

```bash
pct enter 213
apt update && apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
```

### Environment file

`/opt/aarental/.env` — **chmod 600**, never in git:

```bash
NODE_ENV=production
APP_URL=https://aa-rentacar.com

DATABASE_URL=postgresql://aarental:<PASSWORD>@10.10.10.21:5432/aarental
REDIS_URL=redis://:<PASSWORD>@10.10.10.22:6379

S3_ENDPOINT=http://10.10.10.23:9000
S3_PUBLIC_URL=https://cdn.aa-rentacar.com
S3_ACCESS_KEY=<SVCACCT_KEY>
S3_SECRET_KEY=<SVCACCT_SECRET>
S3_BUCKET_KYC=aa-kyc
S3_BUCKET_INSPECTIONS=aa-inspections
S3_BUCKET_CONTRACTS=aa-contracts
S3_BUCKET_VEHICLES=aa-vehicles

SESSION_SECRET=<64_RANDOM_HEX>
NOTIFY_DRIVER=live
TZ=UTC
```

```bash
mkdir -p /opt/aarental && chmod 700 /opt/aarental
# write .env, then:
chmod 600 /opt/aarental/.env
```

### Pulling images

Authenticate to GHCR with a **read-only** token — this box never needs write access:

```bash
echo "<GHCR_READ_TOKEN>" | docker login ghcr.io -u vishnumelur --password-stdin
```

`/opt/aarental/docker-compose.yml`:

```yaml
services:
  web:
    image: ghcr.io/vishnumelur/aarentacarweb:${TAG:-latest}
    env_file: /opt/aarental/.env
    ports: ["3000:3000"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
```

---

## 6. Worker container (CTID 214)

Same Docker install as §5. Same `.env` **except** it runs the worker entrypoint and needs no
public port. It requires `DATABASE_URL`, `REDIS_URL` and the S3 variables; it also holds the
SMS, WhatsApp and email provider credentials, since it sends all notifications.

```yaml
services:
  worker:
    image: ghcr.io/vishnumelur/aarentacarweb:${TAG:-latest}
    command: ["node", "apps/worker/dist/index.js"]
    env_file: /opt/aarental/.env
    restart: unless-stopped
```

---

## 7. Caddy (existing LXC 100)

Add to `/etc/caddy/Caddyfile`:

```caddy
aa-rentacar.com, www.aa-rentacar.com {
    encode zstd gzip
    reverse_proxy 10.10.10.24:3000 {
        health_uri /api/health
        health_interval 10s
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        -Server
    }
    request_body { max_size 25MB }   # inspection photo uploads
}

cdn.aa-rentacar.com {
    encode zstd gzip
    reverse_proxy 10.10.10.23:9000
    header Cache-Control "public, max-age=31536000, immutable"
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy obtains and renews TLS certificates automatically. DNS `A` records for both hostnames
must point at the node's public IP first, or issuance fails.

> `request_body max_size` matters — the default rejects multi-photo handover uploads and the
> failure looks like a mysterious client-side error.

---

## 8. Deploy pipeline

**Never run `next build` on the node** (spec §3) — it peaks at 4–6 GB and will OOM neighbouring
containers.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push: { branches: [main] }

jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: |
            ghcr.io/vishnumelur/aarentacarweb:latest
            ghcr.io/vishnumelur/aarentacarweb:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/aarental
            echo "TAG=${{ github.sha }}" > .tag
            docker compose pull
            docker compose run --rm web npm run db:migrate
            docker compose up -d --wait
            docker image prune -f
```

### Migration discipline

Schema does not deploy atomically. During cutover the old and new containers run against one
database simultaneously.

**Expand → deploy → contract, as three separate deploys:**

1. Add the new column as nullable, deploy, backfill.
2. Deploy code that writes both old and new, reads new.
3. Only once no running container reads the old column, drop it.

Never rename or drop a column in the same deploy that stops using it.

---

## 9. Backups

### Postgres — dump before snapshot

A filesystem snapshot of a running Postgres is **not** a reliable restore point.

On CTID 210, `/usr/local/bin/pg-predump.sh`:

```bash
#!/bin/bash
set -euo pipefail
mkdir -p /var/backups/pg
su - postgres -c "pg_dump -Fc aarental" > /var/backups/pg/aarental-$(date +%F).dump
find /var/backups/pg -name '*.dump' -mtime +7 -delete
```

```bash
chmod +x /usr/local/bin/pg-predump.sh
```

On the **Proxmox node**, `/etc/pve/vzdump.conf`:

```
script: /usr/local/bin/vzdump-hook.sh
```

`/usr/local/bin/vzdump-hook.sh`:

```bash
#!/bin/bash
if [ "$1" = "pre-stop" ] || [ "$1" = "backup-start" ]; then
  [ "$VMID" = "210" ] && pct exec 210 -- /usr/local/bin/pg-predump.sh
fi
exit 0
```

### PBS schedule

Datacenter → Backup → Add: containers `210–214`, storage `PBS-Local`, daily at `03:00`,
mode **snapshot**, retention `keep-daily=7, keep-weekly=4, keep-monthly=6`.

### MinIO replication

Weekly to a Hetzner Storage Box:

```bash
mc alias set offsite https://<storagebox-endpoint> <USER> <PASS>
mc mirror --overwrite --remove local/aa-inspections offsite/aa-inspections
mc mirror --overwrite --remove local/aa-contracts   offsite/aa-contracts
mc mirror --overwrite --remove local/aa-kyc         offsite/aa-kyc
```

### Restore drill — do this before real customer data exists

An untested backup is not a backup. Once per quarter:

```bash
pct restore 999 <backup-volume> --storage local-lvm     # restore to a scratch CTID
pct start 999
# verify: row counts, latest booking, a signed contract PDF opens
pct stop 999 && pct destroy 999
```

Record the wall-clock time. That number is your real RTO, not the 4 hours in the spec.

---

## 10. Security checklist

- [ ] SSH: key-only, `PasswordAuthentication no`, root login disabled
- [ ] Only `aa-web` reachable from Caddy; nothing else exposed publicly
- [ ] `ufw` on each container: allow only the specific peer IPs that need the port
- [ ] Postgres `listen_addresses` bound to `10.10.10.21`, `pg_hba` restricted to `.24` and `.25`
- [ ] Redis `requirepass` set and bound to `10.10.10.22`
- [ ] MinIO buckets private except `aa-vehicles`; app uses a service account, not root
- [ ] All `.env` files `chmod 600`, owned by root
- [ ] `unattended-upgrades` installed on every container
- [ ] Fail2ban on the Caddy container for auth endpoints
- [ ] GHCR token on the node is **read-only**
- [ ] Deploy SSH key is a dedicated `deploy` user, not root
- [ ] **The application's database role cannot `TRUNCATE`.** `handovers` and `inspection_photos`
      are protected against UPDATE and DELETE by row-level triggers (migration `0008`), but
      `TRUNCATE` fires no row triggers and would erase dispute evidence silently. The app role
      needs INSERT/SELECT/UPDATE/DELETE and nothing more — it must not own these tables:
      `REVOKE TRUNCATE ON handovers, inspection_photos FROM aarental;`
      Verify with `\dp handovers` that no TRUNCATE privilege is granted.

Regarding PDPL: the KYC bucket holds passport and Emirates ID scans. Access must be via signed
URLs with short expiry, every access logged, and a documented retention period.

---

## 11. Constrained node

If the node cannot spare 16 GB, consolidate rather than overcommit:

| Change | Saves | Cost |
|---|---|---|
| Fold `aa-redis` and `aa-worker` into `aa-web` | ~2 GB, 2 CTIDs | Worker OOM can take down web |
| Fold `aa-minio` into `aa-web`, store on a mounted volume | ~1.5 GB | Object storage competes with SSR for I/O |
| Reduce `aa-web` to 4 GB, single Node worker | 2 GB | Halves concurrent request capacity |

Absolute floor: one 4-core / 8 GB container running web, worker, Redis and MinIO, with
Postgres separate at 2 cores / 4 GB. Below that, Postgres starts swapping and every page is slow.

---

## 12. Troubleshooting

| Symptom | First check |
|---|---|
| 502 from Caddy | `docker compose ps` on 213; `docker compose logs web --tail 100` |
| Deploy succeeded, site unchanged | Did `docker compose pull` actually fetch? Check the `TAG` value |
| Uploads fail silently | Caddy `request_body max_size`; MinIO disk full (`df -h` on 212) |
| Photos 404 in production | `S3_PUBLIC_URL` wrong, or `cdn.` DNS/TLS not resolving |
| Slow queries | `log_min_duration_statement` output; missing index on `bookings(status, pickup_at)` |
| Jobs not running | Redis reachable from 214? `docker compose logs worker` |
| Postgres won't accept connections | `pg_hba.conf` peer IP; `max_connections` exhausted |
| Container won't start after reboot | `--onboot 1` set? `pct config <CTID> \| grep onboot` |
| `permission denied ... /var/run/docker.sock` | Your shell predates `usermod -aG docker`. A shell's group list is fixed at login, and `newgrp docker` appended to an install chain exits with its own subshell. Open a new terminal, or prefix with `sudo` once. |
| `pg_isready: command not found`, service reported DOWN | Client tools live on the host, not in the images. `scripts/check-services.sh` probes TCP directly and needs none — but to query the database install them: `sudo apt-get install -y postgresql-client redis-tools`. A missing tool is not a down service. |

Logs: application `docker compose logs -f` on 213/214 · Postgres `/var/log/postgresql/` ·
Caddy `journalctl -u caddy -f` · MinIO `journalctl -u minio -f`.
