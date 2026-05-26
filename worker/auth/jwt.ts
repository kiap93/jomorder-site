import * as jose from 'jose';

// Helper to sign JWT using jose (Edge compatible)
export async function signJWT(payload: any, secret: string) {
  const secretKey = new TextEncoder().encode(secret);
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey);
}

// Helper to verify JWT using jose
export async function verifyJWT(token: string, secret: string) {
  const secretKey = new TextEncoder().encode(secret);
  try {
    const { payload } = await jose.jwtVerify(token, secretKey);
    return payload;
  } catch (e) {
    return null;
  }
}

// Helper to verify Google ID Token manually (since google-auth-library is heavy for Edge)
export async function verifyGoogleToken(idToken: string, clientId: string) {
  try {
    // 1. Get Google's public keys
    const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    
    // 2. Verify the token
    const { payload } = await jose.jwtVerify(idToken, JWKS, {
      issuer: 'https://accounts.google.com',
      audience: clientId,
    });
    
    return payload;
  } catch (e) {
    console.error('Google token verification failed:', e);
    return null;
  }
}
