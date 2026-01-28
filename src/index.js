const express = require('express');
const https = require('https');

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NITRADO_TOKEN = process.env.NITRADO_TOKEN;

// Parse SERVICE_IDS: comma-separated list of allowed service IDs
const SERVICE_IDS = (process.env.SERVICE_IDS || process.env.SERVICE_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// Parse API_KEYS: comma-separated list of valid API keys for auth
const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);

// Rate limit config
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Validation
// =============================================================================

if (!NITRADO_TOKEN) {
  console.error('[FATAL] NITRADO_TOKEN environment variable is required');
  process.exit(1);
}

if (SERVICE_IDS.length === 0) {
  console.error('[FATAL] SERVICE_ID or SERVICE_IDS environment variable is required');
  process.exit(1);
}

if (API_KEYS.length === 0) {
  console.warn('[WARN] No API_KEYS configured - authentication is disabled!');
}

// =============================================================================
// Rate Limiter (in-memory)
// =============================================================================

const rateLimitStore = new Map();

function cleanupRateLimiter() {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup every minute
setInterval(cleanupRateLimiter, 60 * 1000);

function checkRateLimit(identifier) {
  const now = Date.now();
  let data = rateLimitStore.get(identifier);

  if (!data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
    data = { windowStart: now, count: 0 };
    rateLimitStore.set(identifier, data);
  }

  data.count++;
  
  return {
    allowed: data.count <= RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - data.count),
    resetAt: data.windowStart + RATE_LIMIT_WINDOW_MS
  };
}

// =============================================================================
// Nitrado API Client
// =============================================================================

function fetchNitradoGameserver(serviceId) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const options = {
      hostname: 'api.nitrado.net',
      path: `/services/${serviceId}/gameservers`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NITRADO_TOKEN}`,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      
      res.on('data', chunk => { body += chunk; });
      
      res.on('end', () => {
        const latency = Date.now() - startTime;
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve({ data: parsed, latency, statusCode: res.statusCode });
          } catch (e) {
            reject({ error: 'parse_error', statusCode: 502 });
          }
        } else {
          reject({ error: 'upstream_failed', statusCode: res.statusCode });
        }
      });
    });

    req.on('error', () => {
      reject({ error: 'upstream_failed', statusCode: 502 });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject({ error: 'upstream_timeout', statusCode: 504 });
    });

    req.end();
  });
}

// =============================================================================
// Response Filtering (Whitelist only specific fields)
// =============================================================================

function filterGameserverResponse(data, latency) {
  const gameserver = data?.data?.gameserver;
  
  if (!gameserver) {
    return null;
  }

  // Extract only whitelisted fields
  const filtered = {
    status: gameserver.status || null,
    server_name: gameserver.settings?.config?.['server-name'] || 
                 gameserver.settings?.config?.serverName ||
                 gameserver.query?.server_name ||
                 null,
    connect_ip: gameserver.ip ? `${gameserver.ip}:${gameserver.port}` : null,
    map: gameserver.query?.map || gameserver.settings?.config?.map || null,
    version: gameserver.query?.version || null,
    player_current: gameserver.query?.player_current ?? null,
    player_max: gameserver.query?.player_max ?? null,
    players: filterPlayers(gameserver.query?.players),
    query_ping: latency || null,
    last_updated: new Date().toISOString()
  };

  return filtered;
}

function filterPlayers(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players.map(player => ({
    name: player.name || 'Unknown',
    ping: player.ping ?? null
  }));
}

// =============================================================================
// Express Application
// =============================================================================

const app = express();

// Disable x-powered-by header
app.disable('x-powered-by');

// =============================================================================
// Middleware: Request Logging
// =============================================================================

app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    // Never log sensitive data like tokens or full headers
    console.log(JSON.stringify({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    }));
  });

  next();
});

// =============================================================================
// Middleware: Authentication
// =============================================================================

function authenticate(req, res, next) {
  // Skip auth if no API keys configured (development mode)
  if (API_KEYS.length === 0) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'missing_api_key' });
  }

  if (!API_KEYS.includes(apiKey)) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }

  next();
}

// =============================================================================
// Middleware: Rate Limiting
// =============================================================================

function rateLimit(req, res, next) {
  // Use API key if present, otherwise fall back to IP
  const identifier = req.headers['x-api-key'] || 
                     req.ip || 
                     req.connection?.remoteAddress || 
                     'unknown';

  const result = checkRateLimit(identifier);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

  if (!result.allowed) {
    return res.status(429).json({ 
      error: 'rate_limit_exceeded',
      retry_after: Math.ceil((result.resetAt - Date.now()) / 1000)
    });
  }

  next();
}

// =============================================================================
// Routes
// =============================================================================

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main endpoint: GET /server-info
app.get('/server-info', authenticate, rateLimit, async (req, res) => {
  try {
    // Determine which service ID to use
    let serviceId = req.query.serviceId || SERVICE_IDS[0];

    // Validate service ID is in allowlist
    if (!SERVICE_IDS.includes(serviceId)) {
      return res.status(400).json({ 
        error: 'invalid_service_id',
        allowed_services: SERVICE_IDS 
      });
    }

    // Fetch from Nitrado
    const { data, latency, statusCode } = await fetchNitradoGameserver(serviceId);

    // Filter response to only whitelisted fields
    const filtered = filterGameserverResponse(data, latency);

    if (!filtered) {
      return res.status(502).json({ error: 'upstream_failed', status: 502 });
    }

    res.json(filtered);

  } catch (err) {
    // Never leak upstream error details or token
    res.status(err.statusCode || 502).json({ 
      error: err.error || 'upstream_failed', 
      status: err.statusCode || 502 
    });
  }
});

// List available service IDs (if multiple configured)
app.get('/services', authenticate, rateLimit, (req, res) => {
  res.json({ 
    services: SERVICE_IDS,
    count: SERVICE_IDS.length 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`[INFO] Nitrado forwarder listening on port ${PORT}`);
  console.log(`[INFO] Configured service IDs: ${SERVICE_IDS.length}`);
  console.log(`[INFO] API key auth: ${API_KEYS.length > 0 ? 'enabled' : 'disabled'}`);
  console.log(`[INFO] Rate limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`);
});
