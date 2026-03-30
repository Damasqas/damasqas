import { Router } from 'express';
import type { MetricsStore } from '../store.js';

export function eventRoutes(store: MetricsStore): Router {
  const router = Router();

  // List events with optional filters
  router.get('/events', (req, res) => {
    try {
      const since = parseInt(req.query.since as string, 10) || (Date.now() - 60 * 60 * 1000);
      const until = parseInt(req.query.until as string, 10) || Date.now();
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 1000);
      const queue = req.query.queue as string | undefined;
      const eventType = req.query.type as string | undefined;

      const events = store.getAllEvents(since, until, limit, queue, eventType);
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Full-text search events
  router.get('/events/search', (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: 'Query parameter q is required' });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
      const events = store.searchEvents(query, limit);
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: 'Failed to search events' });
    }
  });

  // Events for a specific queue
  router.get('/queues/:name/events', (req, res) => {
    try {
      const queue = req.params.name!;
      const since = parseInt(req.query.since as string, 10) || (Date.now() - 60 * 60 * 1000);
      const until = parseInt(req.query.until as string, 10) || Date.now();
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 1000);

      const events = store.getEvents(queue, since, until, limit);
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch queue events' });
    }
  });

  return router;
}
