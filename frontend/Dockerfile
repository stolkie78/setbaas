FROM node:20-alpine AS builder

ARG BASE_PATH=""
ENV BASE_PATH=${BASE_PATH}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV BODY_SIZE_LIMIT=104857600
EXPOSE 3000
CMD ["node", "build"]
