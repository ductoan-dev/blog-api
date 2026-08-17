# --- deps stage: installs npm packages (bcrypt needs a C++ toolchain to build) ---
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- runtime stage: lean image, no build toolchain ---
FROM node:20-slim
WORKDIR /app
# Prisma's query engine needs OpenSSL present to detect the right engine build;
# without it, `prisma generate` silently defaults to the wrong libssl version.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generates the Prisma Client for this container's platform (linux x64 glibc)
RUN npx prisma generate

EXPOSE 3000
CMD ["node", "server.js"]
