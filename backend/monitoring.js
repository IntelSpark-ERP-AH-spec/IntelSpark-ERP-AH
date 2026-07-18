import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from './db.js';
import { getRuntimeConfig } from './runtime-config.js';

const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const counters = {
  requests: 0,
  errors: 0,
  duration_ms_total: 0,
  active_requests: 0,
  window_requests: 0,
  window_errors: 0,
};

function alertOnce(source, severity, message, details) {
  const existing = dbGet(`SELECT id FROM system_alerts
    WHERE source = ? AND message = ? AND resolved = 0
      AND created_at > datetime('now', '-15 minutes') LIMIT 1`, [source, message]);
  if (existing) return null;
  const id = uuidv4();
  dbRun(`INSERT INTO system_alerts (id, severity, source, message, details_json)
    VALUES (?, ?, ?, ?, ?)`, [id, severity, source, message, JSON.stringify(details)]);
  return { id, severity, source, message, details };
}

function resolveAlert(source, message) {
  dbRun(`UPDATE system_alerts SET resolved = 1, resolved_at = datetime('now')
    WHERE source = ? AND message = ? AND resolved = 0`, [source, message]);
}

export function recordSystemError(error, context = {}) {
  const status = Number(context.status || error?.status || 500);
  if (status < 500) return null;
  const method = String(context.method || 'SYSTEM').slice(0, 12);
  const path = String(context.path || context.operation || 'runtime').split('?')[0].slice(0, 160);
  return alertOnce(`server:${method}:${path}`, 'critical', 'Erreur serveur non gérée', {
    error_name: String(error?.name || 'Error').slice(0, 80),
    error_message: String(error?.message || 'Erreur interne').slice(0, 300),
    request_id: String(context.request_id || '').slice(0, 128),
    status,
    occurred_at: new Date().toISOString(),
  });
}

export function metricsMiddleware(req, res, next) {
  const started = performance.now();
  counters.requests += 1;
  counters.window_requests += 1;
  counters.active_requests += 1;
  res.once('finish', () => {
    counters.active_requests = Math.max(0, counters.active_requests - 1);
    counters.duration_ms_total += performance.now() - started;
    if (res.statusCode >= 500) {
      counters.errors += 1;
      counters.window_errors += 1;
    }
  });
  next();
}

export function metricsText() {
  const memory = process.memoryUsage();
  const meanDelayMs = Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1e6 : 0;
  const maxDelayMs = Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : 0;
  const averageDuration = counters.requests ? counters.duration_ms_total / counters.requests : 0;
  return [
    '# HELP intelsheets_uptime_seconds Process uptime',
    '# TYPE intelsheets_uptime_seconds gauge',
    `intelsheets_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
    '# HELP intelsheets_http_requests_total HTTP requests',
    '# TYPE intelsheets_http_requests_total counter',
    `intelsheets_http_requests_total ${counters.requests}`,
    '# HELP intelsheets_http_errors_total HTTP server errors',
    '# TYPE intelsheets_http_errors_total counter',
    `intelsheets_http_errors_total ${counters.errors}`,
    '# HELP intelsheets_http_active_requests Active HTTP requests',
    '# TYPE intelsheets_http_active_requests gauge',
    `intelsheets_http_active_requests ${counters.active_requests}`,
    '# HELP intelsheets_http_duration_average_ms Average HTTP duration',
    '# TYPE intelsheets_http_duration_average_ms gauge',
    `intelsheets_http_duration_average_ms ${averageDuration.toFixed(3)}`,
    '# HELP intelsheets_memory_rss_bytes Resident memory',
    '# TYPE intelsheets_memory_rss_bytes gauge',
    `intelsheets_memory_rss_bytes ${memory.rss}`,
    '# HELP intelsheets_heap_used_bytes Heap usage',
    '# TYPE intelsheets_heap_used_bytes gauge',
    `intelsheets_heap_used_bytes ${memory.heapUsed}`,
    '# HELP intelsheets_event_loop_delay_mean_ms Event loop mean delay',
    '# TYPE intelsheets_event_loop_delay_mean_ms gauge',
    `intelsheets_event_loop_delay_mean_ms ${meanDelayMs.toFixed(3)}`,
    '# HELP intelsheets_event_loop_delay_max_ms Event loop maximum delay',
    '# TYPE intelsheets_event_loop_delay_max_ms gauge',
    `intelsheets_event_loop_delay_max_ms ${maxDelayMs.toFixed(3)}`,
    '',
  ].join('\n');
}

export function metricsHandler(req, res) {
  const expectedToken = process.env.METRICS_TOKEN;
  const suppliedToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const internalAccess = process.env.METRICS_ALLOW_UNAUTHENTICATED === 'true';
  if (process.env.NODE_ENV === 'production' && !internalAccess && (!expectedToken || suppliedToken !== expectedToken)) {
    return res.status(401).type('text/plain').send('Unauthorized');
  }
  return res.type('text/plain; version=0.0.4; charset=utf-8').send(metricsText());
}

export function startMonitoring({ onCriticalAlert } = {}) {
  eventLoop.enable();
  const triggerRecovery = (alert) => {
    if (!alert || alert.severity !== 'critical' || typeof onCriticalAlert !== 'function') return;
    Promise.resolve(onCriticalAlert(alert)).catch((error) => {
      console.error('Correction automatique interrompue:', error?.message || error);
    });
  };
  const inspect = () => {
    try {
      const memoryRssMb = process.memoryUsage().rss / 1024 / 1024;
      const eventLoopMaxMs = Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : 0;
      const memoryThreshold = getRuntimeConfig('alert_memory_rss_mb', 1024);
      const eventLoopThreshold = getRuntimeConfig('alert_event_loop_ms', 250);
      const errorRate = counters.window_requests ? (counters.window_errors / counters.window_requests) * 100 : 0;
      if (memoryRssMb > memoryThreshold) {
        triggerRecovery(alertOnce('runtime', 'critical', 'Memoire processus elevee', { memory_rss_mb: Math.round(memoryRssMb), threshold_mb: memoryThreshold }));
      } else {
        resolveAlert('runtime', 'Memoire processus elevee');
      }
      if (eventLoopMaxMs > eventLoopThreshold) {
        alertOnce('runtime', 'warning', 'Latence boucle evenement elevee', { event_loop_max_ms: Math.round(eventLoopMaxMs), threshold_ms: eventLoopThreshold });
      } else {
        resolveAlert('runtime', 'Latence boucle evenement elevee');
      }
      if (counters.window_requests >= 10 && errorRate >= 10) {
        triggerRecovery(alertOnce('http', 'critical', 'Taux erreurs serveur eleve', {
          error_rate_percent: Number(errorRate.toFixed(1)),
          requests: counters.window_requests,
          errors: counters.window_errors,
        }));
      } else {
        resolveAlert('http', 'Taux erreurs serveur eleve');
      }
    } catch (error) {
      console.error('Surveillance système interrompue:', error?.message || error);
    } finally {
      counters.window_requests = 0;
      counters.window_errors = 0;
      eventLoop.reset();
    }
  };
  inspect();
  const timer = setInterval(inspect, 30_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    eventLoop.disable();
  };
}
