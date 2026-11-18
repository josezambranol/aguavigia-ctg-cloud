FROM eclipse-temurin:21-jre-jammy

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install Redis, PostgreSQL, Node.js 22, and MongoDB 7.0 Server
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl gnupg ca-certificates lsb-release redis-server postgresql postgresql-contrib \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor \
    && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      nodejs mongodb-org-server \
    && rm -rf /var/lib/apt/lists/*

# Install Node dependencies for seeder scripts
WORKDIR /app/scripts
COPY scripts/package.json scripts/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application artifacts
WORKDIR /app
COPY data/geoespacial /app/data/geoespacial
COPY scripts /app/scripts
COPY dist /app/dist
COPY app.jar /app/app.jar
COPY gateway-cloud.mjs /app/gateway-cloud.mjs
COPY entrypoint-cloud.sh /app/entrypoint-cloud.sh

RUN useradd -m -u 1000 aguavigia 2>/dev/null || true \
    && mkdir -p /app/data/fotos /tmp/mongo-data /tmp/pgdata /tmp/pgrun \
    && sed -i 's/\r$//' /app/entrypoint-cloud.sh \
    && chmod +x /app/entrypoint-cloud.sh \
    && chmod -R 777 /app/data /tmp/mongo-data /tmp/pgdata /tmp/pgrun

EXPOSE 7860 10000

ENTRYPOINT ["/app/entrypoint-cloud.sh"]
