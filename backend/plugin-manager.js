import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins');
let registry = new Map();

function allowedPlugins() {
  return new Set(String(process.env.PLUGIN_ALLOWLIST || 'system-insights')
    .split(',').map((value) => value.trim()).filter(Boolean));
}

function validIdentifier(value) {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(String(value || ''));
}

function validateManifest(manifest, directoryName) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest plugin invalide');
  if (!validIdentifier(manifest.id) || manifest.id !== directoryName) throw new Error('Identifiant plugin invalide');
  if (typeof manifest.name !== 'string' || manifest.name.length < 2 || manifest.name.length > 100) throw new Error('Nom plugin invalide');
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ''))) throw new Error('Version plugin invalide');
  if (!manifest.actions || typeof manifest.actions !== 'object') throw new Error('Actions plugin requises');
  for (const [action, config] of Object.entries(manifest.actions)) {
    if (!validIdentifier(action)) throw new Error('Action plugin invalide');
    if (!Array.isArray(config.roles) || !config.roles.length) throw new Error('Roles plugin requis');
  }
}

export async function reloadPlugins() {
  const next = new Map();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validIdentifier(entry.name) || !allowedPlugins().has(entry.name)) continue;
    const pluginDirectory = path.resolve(root, entry.name);
    if (path.dirname(pluginDirectory) !== root) continue;
    const manifestPath = path.join(pluginDirectory, 'plugin.json');
    const handlerPath = path.join(pluginDirectory, 'handler.mjs');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(handlerPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest, entry.name);
    if (manifest.enabled === false) continue;
    const version = fs.statSync(handlerPath).mtimeMs;
    const moduleUrl = `${pathToFileURL(handlerPath).href}?version=${version}`;
    const module = await import(moduleUrl);
    if (typeof module.execute !== 'function') throw new Error(`Executeur plugin absent: ${manifest.id}`);
    next.set(manifest.id, { manifest, execute: module.execute, loaded_at: new Date().toISOString() });
  }
  registry = next;
  return listPlugins();
}

export function listPlugins() {
  return [...registry.values()].map(({ manifest, loaded_at }) => ({ ...manifest, loaded_at }));
}

export async function executePlugin(pluginId, action, context) {
  const plugin = registry.get(pluginId);
  if (!plugin) throw Object.assign(new Error('Plugin introuvable'), { status: 404 });
  const actionConfig = plugin.manifest.actions[action];
  if (!actionConfig) throw Object.assign(new Error('Action plugin introuvable'), { status: 404 });
  if (!actionConfig.roles.includes(context.user.role)) throw Object.assign(new Error('Role plugin refuse'), { status: 403 });
  return plugin.execute({ action, ...context });
}
