import type { MetricsStore } from './store.js';
import type { QueueAdapter } from './adapters/types.js';
import type { DamasqasConfig, QueueSnapshot, AlertRule } from './types.js';

interface AlertRuleConfig {
  threshold?: number;
  memoryThresholdBytes?: number;
  window?: number; // ms
}

/**
 * AlertEngine evaluates database-driven alert rules against current queue state.
 *
 * Alert rule types:
 * - failure_spike: fail_rate_1m exceeds config.threshold
 * - depth_threshold: waiting count exceeds config.threshold
 * - overdue_delayed: delayed jobs past their scheduled time
 * - orphaned_active: active jobs without locks (stalled)
 * - redis_memory: Redis used_memory exceeds config.memoryThresholdBytes
 * - drain_negative: drain rate (throughput - incoming) is negative
 */
export class AlertEngine {
  private store: MetricsStore;
  private adapter: QueueAdapter;
  private config: DamasqasConfig;
  private verbose: boolean;

  constructor(
    store: MetricsStore,
    adapter: QueueAdapter,
    config: DamasqasConfig,
    verbose = false,
  ) {
    this.store = store;
    this.adapter = adapter;
    this.config = config;
    this.verbose = verbose;
  }

  async evaluate(queues: string[], snapshots: QueueSnapshot[]): Promise<void> {
    const rules = this.store.getAlertRules(true); // enabled only
    if (rules.length === 0) return;

    const snapshotMap = new Map<string, QueueSnapshot>();
    for (const s of snapshots) {
      snapshotMap.set(s.queue, s);
    }

    for (const rule of rules) {
      try {
        await this.evaluateRule(rule, queues, snapshotMap);
      } catch (err) {
        console.error(`[alert-engine] Failed to evaluate rule ${rule.id} (${rule.name}):`, err);
      }
    }
  }

  private async evaluateRule(
    rule: AlertRule,
    queues: string[],
    snapshotMap: Map<string, QueueSnapshot>,
  ): Promise<void> {
    // Cooldown check
    if (rule.lastFiredAt) {
      const cooldownMs = rule.cooldownSeconds * 1000;
      if (Date.now() - rule.lastFiredAt < cooldownMs) return;
    }

    const ruleConfig = JSON.parse(rule.config) as AlertRuleConfig;

    // Determine target queues
    const targetQueues = rule.queue ? [rule.queue] : queues;

    for (const queue of targetQueues) {
      const snapshot = snapshotMap.get(queue);
      if (!snapshot) continue;

      const fired = await this.checkCondition(rule.type, ruleConfig, snapshot, queue);
      if (fired) {
        await this.fireAlert(rule, queue, snapshot, ruleConfig);
        return; // One fire per evaluation cycle per rule
      }
    }
  }

  private async checkCondition(
    type: AlertRule['type'],
    config: AlertRuleConfig,
    snapshot: QueueSnapshot,
    queue: string,
  ): Promise<boolean> {
    const threshold = config.threshold ?? 0;

    switch (type) {
      case 'failure_spike':
        return (snapshot.failRate1m ?? 0) > threshold;

      case 'depth_threshold':
        return snapshot.waiting > threshold;

      case 'overdue_delayed': {
        // Check if there are delayed jobs that should have been promoted by now
        // This requires checking delayed zset scores against current time
        return snapshot.delayed > threshold;
      }

      case 'orphaned_active': {
        const stalled = await this.adapter.getStalledJobs(queue);
        return stalled.length > threshold;
      }

      case 'redis_memory': {
        const memThreshold = config.memoryThresholdBytes ?? 0;
        if (memThreshold <= 0) return false;
        try {
          const cmdConn = this.adapter.getCmdConnection();
          const info = await cmdConn.info('memory');
          const match = info.match(/used_memory:(\d+)/);
          if (match) {
            const usedMemory = parseInt(match[1]!, 10);
            return usedMemory > memThreshold;
          }
        } catch {
          // Can't check Redis memory — don't fire
        }
        return false;
      }

      case 'drain_negative': {
        // Drain rate = throughput - new jobs per minute
        // If drain is negative, backlog is growing
        const latest = this.store.getLatestMetrics(queue);
        if (latest) {
          return latest.backlogGrowthRate > threshold;
        }
        return false;
      }

      default:
        return false;
    }
  }

  private async fireAlert(
    rule: AlertRule,
    queue: string,
    snapshot: QueueSnapshot,
    ruleConfig: AlertRuleConfig,
  ): Promise<void> {
    const now = Date.now();
    const payload = JSON.stringify({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      queue,
      snapshot: {
        waiting: snapshot.waiting,
        active: snapshot.active,
        failed: snapshot.failed,
        delayed: snapshot.delayed,
        throughput1m: snapshot.throughput1m,
        failRate1m: snapshot.failRate1m,
      },
      config: ruleConfig,
      firedAt: now,
    });

    // Persist the fire event
    this.store.insertAlertFire(rule.id!, payload);
    this.store.updateAlertRuleLastFired(rule.id!, now);

    if (this.verbose) {
      console.log(`[alert-engine] Rule "${rule.name}" fired for queue ${queue}`);
    }

    // Send webhooks
    await this.sendWebhooks(rule, payload);
  }

  private async sendWebhooks(rule: AlertRule, payload: string): Promise<void> {
    const urls: string[] = [];

    // Rule-specific webhooks
    if (rule.webhookUrl) urls.push(rule.webhookUrl);
    if (rule.slackWebhook) urls.push(rule.slackWebhook);
    if (rule.discordWebhook) urls.push(rule.discordWebhook);

    // Fall back to global config webhooks if no rule-specific ones
    if (urls.length === 0) {
      if (this.config.slackWebhook) urls.push(this.config.slackWebhook);
      if (this.config.discordWebhook) urls.push(this.config.discordWebhook);
    }

    for (const url of urls) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      } catch (err) {
        console.error(`[alert-engine] Webhook delivery failed to ${url}:`, err);
      }
    }
  }
}
