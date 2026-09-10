# Skill Passport — production image for the Next.js app.
#
# Four stages so the layers that change least are cached hardest: pnpm, then
# dependencies, then the build, then a runtime that carries none of it. Only
# the last stage ships.
#
#   docker build -t skill-passport .
#   docker run --rm -p 3000:3000 --env-file .env skill-passport
#
# See apps/nextjs/docs/docker.md for migrations and deployment notes.

# Pinned rather than :22-alpine — a moving base tag makes an image that built
# yesterday and an image that builds today two different things.
FROM node:22.14.0-alpine AS base
# Next's standalone server is compiled against glibc symbols in some
# dependencies; libc6-compat is the Alpine shim for those.
RUN apk add --no-cache libc6-compat
# Matches "packageManager" in package.json, which corepack enforces.
RUN corepack enable pnpm
WORKDIR /repo


# ---------------------------------------------------------------------------
# Dependencies. Only manifests are copied, so this layer is reused for every
# build that does not change a package.json or the lockfile.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/nextjs/package.json        apps/nextjs/package.json
COPY packages/shared/package.json    packages/shared/package.json
COPY tooling/eslint/package.json     tooling/eslint/package.json
COPY tooling/typescript/package.json tooling/typescript/package.json

# --frozen-lockfile: a lockfile that does not match the manifests fails the
# build instead of quietly resolving something else.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile


# ---------------------------------------------------------------------------
# Build.
# ---------------------------------------------------------------------------
FROM base AS builder

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/nextjs/node_modules ./apps/nextjs/node_modules
COPY . .

# The app validates its environment at import time, and a build must not need
# production secrets to run. NEXT_BUILD=1 is the escape hatch src/env.ts
# provides for exactly this; the real values are validated at boot instead.
ENV NEXT_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @skill-passport/nextjs exec next build


# ---------------------------------------------------------------------------
# Runtime. No pnpm, no node_modules, no source — just the traced server.
# ---------------------------------------------------------------------------
FROM node:22.14.0-alpine AS runner

# Chromium renders the candidate report to PDF (see src/server/pdf.ts).
#
# The font list is not padding. Reports contain whatever language the
# candidate answered in, and Alpine ships no Indic fonts — without these the
# PDF renders Hindi, Telugu and Tamil as empty boxes. Verified locally: the
# exported file embeds a subset of an Indic-capable font, and would embed
# nothing to shape with here.
RUN apk add --no-cache \
    libc6-compat \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    font-noto \
    font-noto-devanagari \
    font-noto-bengali \
    font-noto-gujarati \
    font-noto-kannada \
    font-noto-malayalam \
    font-noto-oriya \
    font-noto-gurmukhi \
    font-noto-tamil \
    font-noto-telugu

# puppeteer-core ships no browser; this is the one it drives.
ENV CHROMIUM_PATH=/usr/bin/chromium

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Binds to every interface. The default is localhost, which inside a
# container means nothing outside it can ever connect.
ENV HOSTNAME=0.0.0.0

# Never run as root: a process that does not need to write to the image
# should not be able to.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

# `standalone` mirrors the workspace layout, so the server ends up at
# apps/nextjs/server.js with a pruned node_modules beside it.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/nextjs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/nextjs/.next/static ./apps/nextjs/.next/static

# Only if the app has one — an empty public/ is fine, a missing one is not.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/nextjs/publi[c] ./apps/nextjs/public

USER nextjs
EXPOSE 3000

# No shell wrapper: node is PID 1 and receives SIGTERM directly, so the
# container stops promptly instead of waiting out the kill timeout.
CMD ["node", "apps/nextjs/server.js"]
