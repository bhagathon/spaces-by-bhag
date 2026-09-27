export const newId = () => crypto.randomUUID();

export async function hashJson(value: unknown): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
