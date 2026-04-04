FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /gemotvis .

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /gemotvis /gemotvis
COPY testdata/v9-diplomacy.json /data/v9-diplomacy.json
EXPOSE 9090
ENTRYPOINT ["/gemotvis", "replay", "/data/v9-diplomacy.json"]
