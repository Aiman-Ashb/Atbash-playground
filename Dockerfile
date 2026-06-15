# ── STAGE 1: BUILD THE NEXT.JS APPLICATION ──
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies based on package-lock.json
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code and compile
COPY . .
RUN npm run build

# ── STAGE 2: RUN THE APPLICATION ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary production artifacts from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

# Expose Next.js server port
EXPOSE 3000

# Start Next.js in production mode
CMD ["npm", "run", "start"]
