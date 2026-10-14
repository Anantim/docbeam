import { createLogger } from '@docbeam/shared';

const log = createLogger('sweeper');

/** What an EventBridge Scheduler schedule sends: re-send every minute, clean up once a day (ADR-014). */
export interface SweeperEvent {
  task: 'resend' | 'cleanup';
}

export async function handler(event: SweeperEvent): Promise<void> {
  log.info('sweeper run', { task: event.task });
}
