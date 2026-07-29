import crypto from 'crypto';
import { createClient } from 'redis';

const instanceId = process.env.INSTANCE_ID || crypto.randomUUID();
const environment = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const channel = process.env.REDIS_CHANNEL || `intelspark:${environment}:realtime:v1`;
let publisher = null;
let subscriber = null;
let state = { enabled: false, connected: false, error: null, instance_id: instanceId };

function safeRedisError(error) {
  return String(error?.code || error?.name || 'REDIS_UNAVAILABLE').slice(0, 80);
}

function redisClientOptions(redisUrl) {
  return {
    url: redisUrl,
    socket: {
      connectTimeout: 10_000,
      keepAlive: 5_000,
      reconnectStrategy: (retries) => (
        retries >= 12
          ? new Error('REDIS_RECONNECT_LIMIT')
          : Math.min(250 * (2 ** Math.min(retries, 6)), 10_000)
      ),
    },
  };
}

export async function initRealtimeBus(handler) {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  if (!redisUrl) return state;

  publisher = createClient(redisClientOptions(redisUrl));
  subscriber = publisher.duplicate();
  const onError = (error) => {
    state = { ...state, connected: false, error: safeRedisError(error) };
  };
  publisher.on('error', onError);
  subscriber.on('error', onError);
  publisher.on('ready', () => { state = { ...state, enabled: true, connected: true, error: null }; });
  subscriber.on('ready', () => { state = { ...state, enabled: true, connected: true, error: null }; });
  publisher.on('end', () => { state = { ...state, connected: false }; });
  subscriber.on('end', () => { state = { ...state, connected: false }; });

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
    state = { enabled: true, connected: false, error: safeRedisError(error), instance_id: instanceId };
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
