// =============================================================================
// Configuration (from environment variables)
// =============================================================================

const NITRADO_TOKEN = process.env.NITRADO_TOKEN;

const SERVICE_IDS = (process.env.SERVICE_IDS || process.env.SERVICE_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 5 * 60 * 1000;

// =============================================================================
// Edge Runtime Config
// =============================================================================

export const config = {
  runtime: 'edge',
};

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function authenticate(request) {
  if (API_KEYS.length === 0) {
    return { valid: true };
  }

  const apiKey = request.headers.get('x-api-key');

  if (!apiKey) {
    return { valid: false, error: 'missing_api_key' };
  }

  if (!API_KEYS.includes(apiKey)) {
    return { valid: false, error: 'invalid_api_key' };
  }

  return { valid: true };
}

// =============================================================================
// Nitrado API Client
// =============================================================================

async function fetchNitradoGameserver(serviceId) {
  const startTime = Date.now();

  const response = await fetch(`https://api.nitrado.net/services/${serviceId}/gameservers`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${NITRADO_TOKEN}`,
      'Accept': 'application/json',
    },
  });

  const latency = Date.now() - startTime;

  if (!response.ok) {
    throw { error: 'upstream_failed', statusCode: response.status };
  }

  try {
    const data = await response.json();
    return { data, latency, statusCode: response.status };
  } catch (e) {
    throw { error: 'parse_error', statusCode: 502 };
  }
}

// =============================================================================
// Response Filtering
// =============================================================================

function filterPlayers(players) {
  if (!Array.isArray(players)) {
    return [];
  }

  return players.map(player => ({
    name: player.name || 'Unknown',
    ping: player.ping ?? null,
  }));
}

function filterGameserverResponse(data, latency) {
  const gameserver = data?.data?.gameserver;

  if (!gameserver) {
    return null;
  }

  return {
    status: gameserver.status || null,
    server_name:
      gameserver.settings?.config?.['server-name'] ||
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
    last_updated: new Date().toISOString(),
  };
}

// =============================================================================
// Main Handler
// =============================================================================

export default async function handler(request) {
  // Validate configuration
  if (!NITRADO_TOKEN) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  if (SERVICE_IDS.length === 0) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  // Authentication
  const auth = authenticate(request);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error }, 401);
  }

  // Parse query parameters
  const url = new URL(request.url);
  const serviceId = url.searchParams.get('serviceId') || SERVICE_IDS[0];

  // Validate service ID is in allowlist
  if (!SERVICE_IDS.includes(serviceId)) {
    return jsonResponse(
      {
        error: 'invalid_service_id',
        allowed_services: SERVICE_IDS,
      },
      400
    );
  }

  try {
    const { data, latency } = await fetchNitradoGameserver(serviceId);
    const filtered = filterGameserverResponse(data, latency);

    if (!filtered) {
      return jsonResponse({ error: 'upstream_failed', status: 502 }, 502);
    }

    return jsonResponse(filtered);
  } catch (err) {
    return jsonResponse(
      {
        error: err.error || 'upstream_failed',
        status: err.statusCode || 502,
      },
      err.statusCode || 502
    );
  }
}
