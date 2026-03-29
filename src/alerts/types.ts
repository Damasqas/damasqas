import type { AlertPayload } from '../types.js';

export interface AlertChannel {
  send(payload: AlertPayload): Promise<void>;
}
