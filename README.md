# Nitrado API Forwarder

A minimal HTTP forwarder that shields your bot from the Nitrado API token. It proxies requests to the Nitrado API and returns only whitelisted fields, never exposing your token.

## Features

- ✅ Token shielding - Nitrado token never exposed to clients
- ✅ Field whitelisting - Only returns safe, specified fields
- ✅ API key authentication
- ✅ Rate limiting (in-memory)
- ✅ Multiple service ID support
- ✅ Minimal logging (no sensitive data)
- ✅ Lightweight Docker image

## Quick Start

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repo>
   cd nitrado-forwarder
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Run:**
   ```bash
   npm start
   ```

### Docker

1. **Build:**
   ```bash
   docker build -t nitrado-forwarder .
   ```

2. **Run:**
   ```bash
   docker run -d \
     -p 3000:3000 \
     -e NITRADO_TOKEN=your_token_here \
     -e SERVICE_IDS=12345678 \
     -e API_KEYS=your-api-key \
     --name nitrado-forwarder \
     nitrado-forwarder
   ```

### Docker Compose

```yaml
version: '3.8'
services:
  nitrado-forwarder:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NITRADO_TOKEN=${NITRADO_TOKEN}
      - SERVICE_IDS=${SERVICE_IDS}
      - API_KEYS=${API_KEYS}
    restart: unless-stopped
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NITRADO_TOKEN` | ✅ Yes | - | Your Nitrado API token |
| `SERVICE_IDS` | ✅ Yes | - | Comma-separated list of allowed service IDs |
| `PORT` | No | `3000` | Server port |
| `API_KEYS` | No | - | Comma-separated list of valid API keys |
| `RATE_LIMIT_MAX` | No | `60` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `300000` | Rate limit window (5 min) |

## API Endpoints

### `GET /server-info`

Fetch gameserver information for a service.

**Headers:**
- `x-api-key`: Required if `API_KEYS` is configured

**Query Parameters:**
- `serviceId` (optional): Specific service ID from allowlist. Defaults to first configured.

**Response:**
```json
{
  "status": "started",
  "server_name": "My Server",
  "connect_ip": "123.45.67.89:27015",
  "map": "TheIsland",
  "version": "1.0.0",
  "player_current": 5,
  "player_max": 70,
  "players": [
    { "name": "Player1", "ping": 45 },
    { "name": "Player2", "ping": 32 }
  ],
  "query_ping": 150,
  "last_updated": "2026-01-28T12:00:00.000Z"
}
```

### `GET /services`

List all configured service IDs.

**Response:**
```json
{
  "services": ["12345678", "87654321"],
  "count": 2
}
```

### `GET /health`

Health check endpoint (no auth required).

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-28T12:00:00.000Z"
}
```

## Sample Requests

### With curl

```bash
# Basic request
curl -H "x-api-key: your-api-key" http://localhost:3000/server-info

# Specific service ID
curl -H "x-api-key: your-api-key" "http://localhost:3000/server-info?serviceId=87654321"

# List services
curl -H "x-api-key: your-api-key" http://localhost:3000/services

# Health check
curl http://localhost:3000/health
```

### With PowerShell

```powershell
# Basic request
Invoke-RestMethod -Uri "http://localhost:3000/server-info" -Headers @{"x-api-key"="your-api-key"}

# Specific service ID
Invoke-RestMethod -Uri "http://localhost:3000/server-info?serviceId=87654321" -Headers @{"x-api-key"="your-api-key"}
```

## Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `missing_api_key` | No x-api-key header provided |
| 401 | `invalid_api_key` | API key not in allowlist |
| 400 | `invalid_service_id` | Service ID not in allowlist |
| 429 | `rate_limit_exceeded` | Too many requests |
| 502 | `upstream_failed` | Nitrado API error (details hidden) |
| 504 | `upstream_timeout` | Nitrado API timeout |

## Security Notes

- The Nitrado token is **never** exposed to clients or logged
- Only whitelisted fields are returned from the Nitrado API
- Rate limiting prevents abuse
- API key authentication protects the endpoint
- Runs as non-root user in Docker
- Minimal dependencies to reduce attack surface

## License

MIT
