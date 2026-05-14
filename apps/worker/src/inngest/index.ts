export { inngest } from './client';
export type { Events } from './events';

import { syncAvailability } from './functions/sync-availability';
import { syncRates } from './functions/sync-rates';

/**
 * All functions Inngest should serve. Add new ones here.
 */
export const inngestFunctions = [syncAvailability, syncRates];
