import crypto from 'crypto';
import { createClient } from 'redis';

const instanceId = process.env.INSTANCE_ID || crypto.randomUUID();
const channel = process.env.REDIS_CHANNEL || 'intelsheets:realtime:v1';
let publisher = null;
let subscriber = null;
let state = { enabled: false, connected: false, error: null, instance_id: instanceId };

export async function initRealtimeBus(handler) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return state;

  publisher = createClient({ url: redisUrl, socket: { reconnectStrategy: (retries) => Math.min(1000 * retries, 10_000) } });
  subscriber = publisher.duplicate();
  const onError = (error) => {
    state = { ...state, connected: false, error: error.message };
  };
  publisher.on('error', onError);
  subscriber.on('error', onError);

  try {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await subscriber.subscribe(channel, (raw) => {
      try {
        const event = JSON.parse(raw);
        if (event.origin === instanceId) return;
        handler(event);
      } catch {}
    });
    state = { enabled: true, connected: true, error: null, instance_id: instanceId };
  } catch (error) {
    state = { enabled: true, connected: false, error: error.message, instance_id: instanceId };
    if (process.env.REDIS_REQUIRED === 'true') throw error;
  }
  return state;
}

export async function publishRealtime(type, target, message) {
  if (!publisher?.isReady) return false;
  await publisher.publish(channel, JSON.stringify({ origin: instanceId, type, target, message, sent_at: new Date().toISOString() }));
  return true;
}

export async function shutdownRealtimeBus() {
  const tasks = [];
  if (subscriber?.isOpen) tasks.push(subscriber.unsubscribe(channel).catch(() => {}), subscriber.quit().catch(() => {}));
  if (publisher?.isOpen) tasks.push(publisher.quit().catch(() => {}));
  await Promise.all(tasks);
  publisher = null;
  subscriber = null;
  state = { ...state, connected: false };
}

export function realtimeBusStatus() {
  return { ...state };
}
