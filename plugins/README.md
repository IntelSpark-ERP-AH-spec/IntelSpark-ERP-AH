# Plugins Intelsheets

Chaque plugin exige:

- repertoire identique a son identifiant
- fichier `plugin.json` valide
- fichier `handler.mjs` exportant `execute`
- identifiant present dans `PLUGIN_ALLOWLIST`
- roles explicites par action

Rechargement dynamique:

```text
POST /api/plugins/reload
```

Execution:

```text
GET /api/plugins/system-insights/summary
```

Seuls administrateurs rechargent plugins.

Chaque action applique roles manifestes.
