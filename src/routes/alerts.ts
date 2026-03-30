import { Router } from 'express';
import type { MetricsStore } from '../store.js';
import type { AlertRule, AlertRuleType } from '../types.js';

const VALID_TYPES: AlertRuleType[] = [
  'failure_spike',
  'depth_threshold',
  'overdue_delayed',
  'orphaned_active',
  'redis_memory',
  'drain_negative',
];

export function alertRoutes(store: MetricsStore): Router {
  const router = Router();

  // List all alert rules
  router.get('/alerts/rules', (_req, res) => {
    try {
      const rules = store.getAlertRules();
      res.json({ rules });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch alert rules' });
    }
  });

  // Create alert rule
  router.post('/alerts/rules', (req, res) => {
    try {
      const body = req.body as Partial<AlertRule>;

      if (!body.name || !body.type || !body.config) {
        res.status(400).json({ error: 'name, type, and config are required' });
        return;
      }

      if (!VALID_TYPES.includes(body.type as AlertRuleType)) {
        res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }

      // Validate config is valid JSON
      try {
        if (typeof body.config === 'string') JSON.parse(body.config);
      } catch {
        res.status(400).json({ error: 'config must be valid JSON' });
        return;
      }

      const rule: AlertRule = {
        name: body.name,
        queue: body.queue ?? null,
        type: body.type as AlertRuleType,
        config: typeof body.config === 'object' ? JSON.stringify(body.config) : body.config,
        webhookUrl: body.webhookUrl ?? null,
        slackWebhook: body.slackWebhook ?? null,
        discordWebhook: body.discordWebhook ?? null,
        enabled: body.enabled ?? true,
        cooldownSeconds: body.cooldownSeconds ?? 300,
        lastFiredAt: null,
      };

      const id = store.insertAlertRule(rule);
      res.status(201).json({ id, ...rule });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create alert rule' });
    }
  });

  // Update alert rule
  router.put('/alerts/rules/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id!, 10);
      const existing = store.getAlertRule(id);
      if (!existing) {
        res.status(404).json({ error: 'Alert rule not found' });
        return;
      }

      const body = req.body as Partial<AlertRule>;

      if (body.type && !VALID_TYPES.includes(body.type as AlertRuleType)) {
        res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        return;
      }

      if (body.config && typeof body.config === 'object') {
        body.config = JSON.stringify(body.config);
      }

      store.updateAlertRule(id, body);
      const updated = store.getAlertRule(id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update alert rule' });
    }
  });

  // Delete alert rule
  router.delete('/alerts/rules/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id!, 10);
      const existing = store.getAlertRule(id);
      if (!existing) {
        res.status(404).json({ error: 'Alert rule not found' });
        return;
      }

      store.deleteAlertRule(id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete alert rule' });
    }
  });

  // Get fire history for a rule
  router.get('/alerts/rules/:id/history', (req, res) => {
    try {
      const id = parseInt(req.params.id!, 10);
      const existing = store.getAlertRule(id);
      if (!existing) {
        res.status(404).json({ error: 'Alert rule not found' });
        return;
      }

      const limit = parseInt(req.query.limit as string, 10) || 50;
      const fires = store.getAlertFires(id, limit);
      res.json({ fires });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch alert history' });
    }
  });

  // Recent fires across all rules
  router.get('/alerts/fires', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const fires = store.getRecentAlertFires(limit);
      res.json({ fires });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch alert fires' });
    }
  });

  return router;
}
