// =============================================================================
// Configuration
// =============================================================================

const SERVICE_IDS = (process.env.SERVICE_IDS || process.env.SERVICE_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map(key => key.trim())
  .filter(Boolean);

// =============================================================================
// Edge Runtime Config
// =============================================================================

export const config = {
  runtime: 'edge',
};

// =============================================================================
// Helpers
// =============================================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
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
// Main Handler
// =============================================================================

export default async function handler(request) {
  // Authentication
  const auth = authenticate(request);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error }, 401);
  }

  return jsonResponse({
    services: SERVICE_IDS,
    count: SERVICE_IDS.length,
  });
}
