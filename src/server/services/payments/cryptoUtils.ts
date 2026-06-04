import crypto from "crypto";

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = (process.env.PAYMENT_ENCRYPTION_KEY || 'jomorder-super-secret-key-32-chars-max!').substring(0, 32).padEnd(32, '0');

export function encrypt(text: string): string {
  if (!text) return "";
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (err) {
    console.warn("[Encryption] Encryption failed, returning plain text fallback:", err);
    return text;
  }
}

export function decrypt(text: string): string {
  if (!text) return "";
  try {
    const parts = text.split(':');
    if (parts.length !== 2) return text; // If not in encrypted structure (hex:hex), return unchanged
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    
    // Collect all unique candidate 32-character key Buffers to try
    const candidatesStr = [
      process.env.PAYMENT_ENCRYPTION_KEY,
      "123",
      "jomorder-super-secret-key-32-chars-max!"
    ].filter((k): k is string => typeof k === 'string' && k.trim() !== '');

    const candidateKeys = Array.from(new Set(
      candidatesStr.map(k => k.substring(0, 32).padEnd(32, '0'))
    ));

    for (const keyStr of candidateKeys) {
      try {
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, Buffer.from(keyStr), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString("utf8");
      } catch (err) {
        // Continue to next candidate
      }
    }
    
    throw new Error("All decryption candidate keys failed");
  } catch (err) {
    console.warn("[Encryption] Decryption failed, returning plain text fallback:", err);
    return text; // Return plain text as fallback
  }
}

export function encryptConfig(config: Record<string, any>): Record<string, any> {
  const encrypted: Record<string, any> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === 'string' && (
      key.toLowerCase().includes('key') || 
      key.toLowerCase().includes('secret') || 
      key.toLowerCase().includes('pk_') || 
      key.toLowerCase().includes('sk_') || 
      key.toLowerCase().includes('credential') || 
      key.toLowerCase().includes('password') || 
      key.toLowerCase().includes('token')
    )) {
      encrypted[key] = encrypt(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      encrypted[key] = encryptConfig(val);
    } else {
      encrypted[key] = val;
    }
  }
  return encrypted;
}

export function decryptConfig(config: Record<string, any>): Record<string, any> {
  const decrypted: Record<string, any> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === 'string' && (
      key.toLowerCase().includes('key') || 
      key.toLowerCase().includes('secret') || 
      key.toLowerCase().includes('pk_') || 
      key.toLowerCase().includes('sk_') || 
      key.toLowerCase().includes('credential') || 
      key.toLowerCase().includes('password') || 
      key.toLowerCase().includes('token')
    )) {
      decrypted[key] = decrypt(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      decrypted[key] = decryptConfig(val);
    } else {
      decrypted[key] = val;
    }
  }
  return decrypted;
}

export function scrubSensitiveConfig(config: Record<string, any>): Record<string, any> {
  const scrubbed: Record<string, any> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === 'string' && (
      key.toLowerCase().includes('key') || 
      key.toLowerCase().includes('secret') || 
      key.toLowerCase().includes('pk_') || 
      key.toLowerCase().includes('sk_') || 
      key.toLowerCase().includes('credential') || 
      key.toLowerCase().includes('password') || 
      key.toLowerCase().includes('token')
    )) {
      const dec = decrypt(val);
      if (dec.length > 8) {
        scrubbed[key] = `${dec.substring(0, 4)}...${dec.substring(dec.length - 4)}`;
      } else {
        scrubbed[key] = "********";
      }
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      scrubbed[key] = scrubSensitiveConfig(val);
    } else {
      scrubbed[key] = val;
    }
  }
  return scrubbed;
}
