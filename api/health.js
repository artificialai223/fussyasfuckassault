// =============================================================================
// Edge Runtime Config
// =============================================================================

export const config = {
  runtime: 'edge',
};

// =============================================================================
// Main Handler
// =============================================================================

export default async function handler() {
  return new Response(
    JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
