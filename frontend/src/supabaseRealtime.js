import { createClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL || '')
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '');
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

const client = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: {
        params: { eventsPerSecond: 40 },
        timeout: 8_000,
      },
    })
  : null;

export function subscribeOrganization(topic, onChange, onStatus) {
  if (!client || !topic) {
    onStatus?.('disabled');
    return () => {};
  }
  const channel = client
    .channel(`org:${topic}`, { config: { private: false } })
    .on('broadcast', { event: 'change' }, ({ payload }) => onChange?.(payload || {}))
    .subscribe(status => onStatus?.(String(status || '').toLowerCase()));
  return () => { client.removeChannel(channel); };
}
