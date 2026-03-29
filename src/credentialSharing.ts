import ImmichPicker from './main'

interface EncryptedBlob {
  serverUrl: string;
  encryptedApiKey: string;
  salt: string;
  iv: string;
  expiresAt: number;
}

// --- Shared crypto helpers ---

function generatePin (): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function toBase64 (buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64 (str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function deriveKey (pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(pin) as BufferSource, 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt (pin: string, plaintext: string): Promise<{ encrypted: string, salt: string, iv: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(pin, salt)
  const encoder = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(plaintext) as BufferSource
  )
  return {
    encrypted: toBase64(ciphertext),
    salt: toBase64(salt),
    iv: toBase64(iv)
  }
}

async function decrypt (pin: string, encrypted: string, salt: string, iv: string): Promise<string | null> {
  try {
    const key = await deriveKey(pin, fromBase64(salt))
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv).buffer as ArrayBuffer },
      key,
      fromBase64(encrypted).buffer as ArrayBuffer
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return null // Wrong PIN or corrupt data
  }
}

// --- Vault sync method ---

export async function createVaultShare (plugin: ImmichPicker, serverUrl: string, apiKey: string, durationMs: number): Promise<string> {
  const pin = generatePin()
  const { encrypted, salt, iv } = await encrypt(pin, apiKey)

  const blob: EncryptedBlob = {
    serverUrl,
    encryptedApiKey: encrypted,
    salt,
    iv,
    expiresAt: Date.now() + durationMs
  }

  // Store in plugin data — syncs with vault
  const data = await plugin.loadData() || {}
  data.sharedCredentials = blob
  await plugin.saveData(data)

  return pin
}

export async function importVaultShare (plugin: ImmichPicker, pin: string): Promise<{ serverUrl: string, apiKey: string } | null> {
  const data = await plugin.loadData()
  const blob = data?.sharedCredentials as EncryptedBlob | undefined
  if (!blob) return null

  if (blob.expiresAt < Date.now()) {
    // Expired — clean up
    delete data.sharedCredentials
    await plugin.saveData(data)
    return null
  }

  const apiKey = await decrypt(pin, blob.encryptedApiKey, blob.salt, blob.iv)
  if (!apiKey) return null

  // Success — clean up shared blob
  delete data.sharedCredentials
  await plugin.saveData(data)

  return { serverUrl: blob.serverUrl, apiKey }
}

export async function hasVaultShare (plugin: ImmichPicker): Promise<boolean> {
  const data = await plugin.loadData()
  const blob = data?.sharedCredentials as EncryptedBlob | undefined
  if (!blob) return false
  return blob.expiresAt >= Date.now()
}

// --- Share string method ---

const SHARE_PREFIX = 'immich-share:'

export async function createShareString (serverUrl: string, apiKey: string, durationMs: number): Promise<{ pin: string, shareString: string }> {
  const pin = generatePin()
  const { encrypted, salt, iv } = await encrypt(pin, apiKey)

  const blob: EncryptedBlob = {
    serverUrl,
    encryptedApiKey: encrypted,
    salt,
    iv,
    expiresAt: Date.now() + durationMs
  }

  const shareString = SHARE_PREFIX + btoa(JSON.stringify(blob))
  return { pin, shareString }
}

export async function importShareString (shareString: string, pin: string): Promise<{ serverUrl: string, apiKey: string } | null> {
  if (!shareString.startsWith(SHARE_PREFIX)) return null

  try {
    const jsonStr = atob(shareString.slice(SHARE_PREFIX.length))
    const blob: EncryptedBlob = JSON.parse(jsonStr)

    if (blob.expiresAt < Date.now()) return null

    const apiKey = await decrypt(pin, blob.encryptedApiKey, blob.salt, blob.iv)
    if (!apiKey) return null

    return { serverUrl: blob.serverUrl, apiKey }
  } catch {
    return null
  }
}
