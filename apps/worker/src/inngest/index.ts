export { inngest } from './client';
export type { Events } from './events';

import { syncAvailability } from './functions/sync-availability';

/**
 * All functions Inngest should serve. Add new ones here.
 */
export const inngestFunctions = [syncAvailability];
