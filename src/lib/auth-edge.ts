const encoder = new TextEncoder();

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = encoder.encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifyAsync(value: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await getHmacKey(secret);
    
    // Parse hex signature string into Uint8Array
    const matches = signature.match(/.{1,2}/g);
    if (!matches) return false;
    const signatureBytes = new Uint8Array(matches.map(byte => parseInt(byte, 16)));
    
    const data = encoder.encode(value);
    return crypto.subtle.verify("HMAC", key, signatureBytes, data);
  } catch (e) {
    return false;
  }
}

/**
 * Verify if the admin session token is cryptographically valid and has the correct prefix.
 * Designed for Next.js Edge Middleware.
 */
export async function verifyAdminSessionTokenAsync(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!value.startsWith("admin_")) return false;
  
  return verifyAsync(value, sig, secret);
}
