import type { AnomalyRecord, DamasqasConfig } from './types.js';

export async function sendCloudEvent(
  config: DamasqasConfig,
  anomaly: AnomalyRecord,
): Promise<void> {
  if (!config.apiKey) return;

  // Cloud integration stub — will POST structured events to api.damasqas.com
  // when the cloud layer is built
  if (config.verbose) {
    console.log(`[cloud] Would send anomaly to cloud: ${anomaly.type} on ${anomaly.queue}`);
  }
}
