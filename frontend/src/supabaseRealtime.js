import { createClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL || 'https://hozhnlzgbccrkdluqjcg.supabase.co').replace(/\/$/, '');
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SJEziwczIuyhec6nsH5tzA_jHdJlB-t');

const client = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
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
