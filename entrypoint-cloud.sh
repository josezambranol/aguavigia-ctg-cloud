#!/bin/sh
set -e

echo "=== [AguaVigia CTG Cloud] Starting unified server ==="
export MALLOC_ARENA_MAX=1

# 1. Start Gateway + Built-in SMTP (1025) + SPA Server on $PORT immediately
export PORT="${PORT:-7860}"
export BACKEND_HOST="127.0.0.1"
export BACKEND_PORT="8080"
export DIST_DIR="/app/dist"
node --max-old-space-size=40 /app/gateway-cloud.mjs &

# 2. Start embedded Redis on 127.0.0.1:6379
echo "[1/5] Starting embedded Redis on 127.0.0.1:6379..."
redis-server --bind 127.0.0.1 --port 6379 --daemonize yes --save "" --appendonly no --maxmemory 10mb --maxmemory-policy allkeys-lru --dir /tmp

# 3. Configure Spring Boot in REAL mode with live Acuacar API (INGESTA_MODO=auto)
export SPRING_PROFILES_ACTIVE="docker"
export SERVER_PORT="8080"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export MAIL_HOST="${MAIL_HOST:-127.0.0.1}"
export MAIL_PORT="${MAIL_PORT:-1025}"
export COLLECTOR_USER_AGENT="${COLLECTOR_USER_AGENT:-AguaVigiaCTG-Bot/1.0 (+alertas@aguavigia.com)}"
export INGESTA_MODO="auto"
export VECINOS_SINTETICOS="0"
export AGUAVIGIA_MODO="REAL"
export AGUAVIGIA_CONSENSO_REDES_MINIMAS="1"
export RATE_LIMIT_FACTOR="100"

if [ -n "$RENDER_EXTERNAL_URL" ]; then
  export APP_URL_PUBLICA="${APP_URL_PUBLICA:-$RENDER_EXTERNAL_URL}"
  export APP_URL_FRONTEND="${APP_URL_FRONTEND:-$RENDER_EXTERNAL_URL}"
  export CORS_ORIGENES="${CORS_ORIGENES:-$RENDER_EXTERNAL_URL,http://localhost:5173}"
elif [ -n "$SPACE_HOST" ]; then
  export APP_URL_PUBLICA="https://${SPACE_HOST}"
  export APP_URL_FRONTEND="https://${SPACE_HOST}"
  export CORS_ORIGENES="https://${SPACE_HOST},http://localhost:5173"
fi

# 4. If MONGODB_URI is not set and local mongod is available, start embedded MongoDB Replica Set
if [ -z "$MONGODB_URI" ] && command -v mongod >/dev/null 2>&1; then
  echo "[2/5] Starting embedded MongoDB 7.0 Replica Set (rs0)..."
  mkdir -p /tmp/mongo-data
  mongod --dbpath /tmp/mongo-data --replSet rs0 --bind_ip 127.0.0.1 --port 27017 --wiredTigerCacheSizeGB 0.25 --fork --logpath /tmp/mongod.log
  cd /app/scripts
  node -e '
    import("mongodb").then(async ({ MongoClient }) => {
      const client = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true");
      await client.connect();
      try {
        await client.db("admin").command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] } });
        console.log("[Mongo] Replica Set rs0 initialized.");
      } catch (e) {
        console.log("[Mongo] Replica Set status:", e.message);
      }
      try {
        await client.db("admin").command({ setParameter: 1, wiredTigerEngineRuntimeConfig: "cache_size=32M" });
        console.log("[Mongo] WiredTiger cache capped at 32MB.");
      } catch (e) {
        console.log("[Mongo] Cache cap note:", e.message);
      }
      await client.close();
    });
  '
  sleep 2
  export MONGODB_URI="mongodb://127.0.0.1:27017/aguavigia?replicaSet=rs0&directConnection=true"
  export SPRING_DATA_MONGODB_URI="$MONGODB_URI"
elif [ -n "$MONGODB_URI" ]; then
  export SPRING_DATA_MONGODB_URI="$MONGODB_URI"
fi

# 5. If AGUAVIGIA_SQL_URL is not set and local postgres is available, start embedded PostgreSQL
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -n 1)
if [ -z "$AGUAVIGIA_SQL_URL" ] && [ -n "$PG_BIN" ]; then
  echo "[3/5] Starting embedded PostgreSQL analytical database..."
  export PATH="$PG_BIN:$PATH"
  mkdir -p /tmp/pgdata /tmp/pgrun
  PG_OPTS="-k /tmp/pgrun -h 127.0.0.1 -p 5432 -c shared_buffers=12MB -c work_mem=1MB -c max_connections=10"
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres:postgres /tmp/pgdata /tmp/pgrun
    su - postgres -c "$PG_BIN/initdb -D /tmp/pgdata --auth=trust >/dev/null 2>&1 || true"
    su - postgres -c "$PG_BIN/pg_ctl -D /tmp/pgdata -l /tmp/pg.log -o '$PG_OPTS' start" || true
    su - postgres -c "$PG_BIN/psql -h 127.0.0.1 -p 5432 -c 'CREATE USER aguavigia WITH SUPERUSER;' postgres >/dev/null 2>&1 || true"
    su - postgres -c "$PG_BIN/createdb -h 127.0.0.1 -p 5432 -O aguavigia aguavigia_analitica >/dev/null 2>&1 || true"
  else
    "$PG_BIN/initdb" -D /tmp/pgdata --auth=trust -U aguavigia >/dev/null 2>&1 || true
    "$PG_BIN/pg_ctl" -D /tmp/pgdata -l /tmp/pg.log -o "$PG_OPTS" start || true
    "$PG_BIN/createdb" -h 127.0.0.1 -p 5432 -U aguavigia aguavigia_analitica >/dev/null 2>&1 || true
  fi
  export AGUAVIGIA_SQL_HABILITADO="true"
  export AGUAVIGIA_SQL_URL="jdbc:postgresql://127.0.0.1:5432/aguavigia_analitica"
  export AGUAVIGIA_SQL_USUARIO="aguavigia"
elif [ -n "$AGUAVIGIA_SQL_URL" ]; then
  export AGUAVIGIA_SQL_HABILITADO="true"
else
  export AGUAVIGIA_SQL_HABILITADO="${AGUAVIGIA_SQL_HABILITADO:-false}"
fi

# 6. Seed the 211 neighborhoods + existing repository scripts so map & analytics show active statuses
(
  sleep 4
  if [ -n "$MONGODB_URI" ]; then
    echo "[4/5] Running repository seeders (sembrar-sectores + sembrar-historico-cortes + sembrar-demo)..."
    cd /app/scripts
    node -e '
      import("mongodb").then(async ({ MongoClient }) => {
        const uri = process.env.MONGODB_URI;
        const dbName = process.env.MONGODB_DB || "aguavigia";
        const client = new MongoClient(uri);
        try {
          await client.connect();
          const db = client.db(dbName);
          const count = await db.collection("sectores").countDocuments();
          const cortesCount = await db.collection("cortes").countDocuments();
          await client.close();
          const { spawnSync } = await import("node:child_process");
          if (count < 211) {
            spawnSync("node", ["sembrar-sectores.mjs", "--permitir-remoto", "--sobre-datos-reales"], { stdio: "inherit" });
          }
          if (cortesCount === 0) {
            spawnSync("node", ["sembrar-historico-cortes.mjs", "--permitir-remoto", "--sobre-datos-reales"], { stdio: "inherit" });
          }
        } catch (err) {
          console.error("[Seeder] Warning:", err.message);
        }
      });
    '
    for i in $(seq 1 60); do
      if curl -sf http://127.0.0.1:8080/actuator/health/readiness >/dev/null 2>&1; then
        echo "[Seeder] Backend is ready! Running sembrar-demo.mjs for active neighborhood statuses..."
        API_URL="http://127.0.0.1:8080" node /app/scripts/sembrar-demo.mjs --sin-agua 3 --presion-baja 2 || true
        break
      fi
      sleep 5
    done
  fi
) &

# 7. Start Spring Boot Backend with live Acuacar API (INGESTA_MODO=auto) and 45-day validity window for last month's bulletins
echo "[5/5] Starting Spring Boot Backend in REAL mode (INGESTA_MODO=auto) on 127.0.0.1:8080..."
cd /app
DEFAULT_JAVA_OPTS="-Xms64m -Xmx215m -XX:MaxMetaspaceSize=128m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss256k -Daguavigia.mongo.max-pool=8 -Daguavigia.ingesta.modo=auto -Daguavigia.ingesta.acuacar.tamanio-pagina=40 -Daguavigia.estado.expira-tras-fin-horas=1080 -Daguavigia.ingesta.compuertas.maximo-de-barrios=215 -Daguavigia.ingesta.compuertas.confianza-minima=0.45 -Daguavigia.ingesta.compuertas.confianza-minima-restablecimiento=0.45 -Daguavigia.ingesta.compuertas.duracion-maxima-horas=240 -Daguavigia.ingesta.compuertas.margen-de-inicio-dias=45 -Daguavigia.siembra.vecinos-sinteticos=0 -Daguavigia.sql.copia-retraso-inicial-ms=20000 -Daguavigia.ingesta.retraso-inicial-ms=35000"
JAVA_RUN_OPTS="${CLOUD_JAVA_OPTS:-$DEFAULT_JAVA_OPTS}"

while true; do
  java $JAVA_RUN_OPTS -jar /app/app.jar
  EXIT_CODE=$?
  echo "[Supervisor] Spring Boot exited with code $EXIT_CODE. Restarting in 3s..."
  sleep 3
done
