import type { AlertChannel } from './types.js';
import type { AlertPayload } from '../types.js';

export class DiscordAlert implements AlertChannel {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(payload: AlertPayload): Promise<void> {
    const { queue, anomaly, snapshot } = payload;

    const typeLabels: Record<string, string> = {
      failure_spike: 'Failure Spike',
      backlog_growth: 'Backlog Growth',
      processing_slow: 'Slow Processing',
      stalled_job: 'Stalled Jobs',
      queue_idle: 'Queue Idle',
      oldest_waiting: 'Old Waiting Job',
    };

    const color = anomaly.severity === 'critical' ? 0xff0000 : 0xffaa00;

    const fields = [
      { name: 'Severity', value: anomaly.severity.toUpperCase(), inline: true },
      { name: 'Multiplier', value: `${anomaly.multiplier.toFixed(1)}×`, inline: true },
      { name: 'Current', value: anomaly.currentValue.toFixed(1), inline: true },
      { name: 'Baseline', value: anomaly.baselineValue.toFixed(1), inline: true },
      { name: 'Waiting', value: String(snapshot.waiting), inline: true },
      { name: 'Active', value: String(snapshot.active), inline: true },
      { name: 'Stalled', value: String(snapshot.stalledCount), inline: true },
      { name: 'Locks', value: String(snapshot.locks), inline: true },
    ];

    if (payload.topErrors.length > 0) {
      const topError = payload.topErrors[0]!;
      fields.push({
        name: `Top Error (${topError.count}×)`,
        value: `\`${topError.reason.slice(0, 200)}\``,
        inline: false,
      });
    }

    const embed = {
      title: `${typeLabels[anomaly.type] || anomaly.type} — ${queue}`,
      color,
      fields,
      timestamp: new Date(anomaly.timestamp).toISOString(),
    };

    const body = JSON.stringify({ embeds: [embed] });

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
    }
  }
}
