import type { AlertChannel } from './types.js';
import type { AlertPayload } from '../types.js';

export class SlackAlert implements AlertChannel {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(payload: AlertPayload): Promise<void> {
    const { queue, anomaly, snapshot } = payload;

    const severityEmoji = anomaly.severity === 'critical' ? ':rotating_light:' : ':warning:';
    const typeLabels: Record<string, string> = {
      failure_spike: 'Failure Spike',
      backlog_growth: 'Backlog Growth',
      processing_slow: 'Slow Processing',
      stalled_job: 'Stalled Jobs',
      queue_idle: 'Queue Idle',
      oldest_waiting: 'Old Waiting Job',
    };

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityEmoji} ${typeLabels[anomaly.type] || anomaly.type} — ${queue}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Severity:*\n${anomaly.severity.toUpperCase()}` },
          { type: 'mrkdwn', text: `*Multiplier:*\n${anomaly.multiplier.toFixed(1)}×` },
          { type: 'mrkdwn', text: `*Current:*\n${anomaly.currentValue.toFixed(1)}` },
          { type: 'mrkdwn', text: `*Baseline:*\n${anomaly.baselineValue.toFixed(1)}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Waiting:*\n${snapshot.waiting}` },
          { type: 'mrkdwn', text: `*Active:*\n${snapshot.active}` },
          { type: 'mrkdwn', text: `*Locks:*\n${snapshot.locks}` },
          { type: 'mrkdwn', text: `*Stalled:*\n${snapshot.stalledCount}` },
        ],
      },
    ];

    // Add top error if available
    if (payload.topErrors.length > 0) {
      const topError = payload.topErrors[0]!;
      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Top Error (${topError.count} occurrences):*\n\`${topError.reason.slice(0, 200)}\``,
          },
        ],
      });
    }

    const body = JSON.stringify({ blocks });

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    }
  }
}
