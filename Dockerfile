FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=frontend /app/internal/server/static internal/server/static
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /gemotvis .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /gemotvis /gemotvis
COPY testdata/ /data/
EXPOSE 9090
ENTRYPOINT ["/gemotvis", "demo"]
