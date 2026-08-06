// A minimal Worker whose ONLY job is to import a JWK the way src/lib/licence.ts does, inside workerd.
// It exists so the cross-runtime crypto boundary is tested on the side that actually runs it.
export default {
  async fetch(request) {
    const jwk = await request.json();
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
      const sig = await crypto.subtle.sign(
        { name: 'Ed25519' },
        key,
        new TextEncoder().encode('probe'),
      );
      return Response.json({ ok: true, sigBytes: new Uint8Array(sig).length });
    } catch (e) {
      return Response.json({ ok: false, error: `${e.name}: ${e.message}` });
    }
  },
};
