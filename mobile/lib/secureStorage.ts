import * as SecureStore from 'expo-secure-store'

// expo-secure-store має ліміт ~2KB на iOS.
// Supabase session може бути більшим, тому ділимо на чанки.
const CHUNK_SIZE = 1800

async function setItemChunked(key: string, value: string): Promise<void> {
  const chunks = Math.ceil(value.length / CHUNK_SIZE)
  await SecureStore.setItemAsync(`${key}_chunks`, String(chunks))
  for (let i = 0; i < chunks; i++) {
    await SecureStore.setItemAsync(
      `${key}_chunk_${i}`,
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    )
  }
}

async function getItemChunked(key: string): Promise<string | null> {
  const chunksStr = await SecureStore.getItemAsync(`${key}_chunks`)
  if (!chunksStr) return null
  const chunks = parseInt(chunksStr, 10)
  const parts: string[] = []
  for (let i = 0; i < chunks; i++) {
    const part = await SecureStore.getItemAsync(`${key}_chunk_${i}`)
    if (part === null) return null
    parts.push(part)
  }
  return parts.join('')
}

async function removeItemChunked(key: string): Promise<void> {
  const chunksStr = await SecureStore.getItemAsync(`${key}_chunks`)
  if (!chunksStr) return
  const chunks = parseInt(chunksStr, 10)
  await SecureStore.deleteItemAsync(`${key}_chunks`)
  for (let i = 0; i < chunks; i++) {
    await SecureStore.deleteItemAsync(`${key}_chunk_${i}`)
  }
}

const SecureStorageAdapter = {
  getItem: (key: string): Promise<string | null> => getItemChunked(key),
  setItem: (key: string, value: string): Promise<void> => setItemChunked(key, value),
  removeItem: (key: string): Promise<void> => removeItemChunked(key),
}

export default SecureStorageAdapter
