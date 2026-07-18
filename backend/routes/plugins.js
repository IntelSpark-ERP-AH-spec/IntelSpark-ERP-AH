import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { executePlugin, listPlugins, reloadPlugins } from '../plugin-manager.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  res.json(listPlugins().map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    actions: Object.keys(plugin.actions),
    loaded_at: plugin.loaded_at,
  })));
});

router.post('/reload', requireRole('admin'), async (req, res) => {
  try { res.json(await reloadPlugins()); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

router.all('/:pluginId/:action', async (req, res) => {
  try {
    const result = await executePlugin(req.params.pluginId, req.params.action, {
      user: req.user,
      method: req.method,
      body: req.body,
      query: req.query,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
