import { notifyOwnerNewSignup, type EmailConfig } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

/**
 * Email the platform owner when a brand-new account registers at Rentaro.
 *
 * Triggered by the API's `me.bootstrap` mutation (event `tenant/registered`),
 * which only fires on a genuine first-time tenant creation. Recipient is
 * OWNER_NOTIFICATION_EMAIL; unset → silently skipped. Resend transport, so it
 * also degrades to a no-op when RESEND_* aren't configured.
 */
export const tenantRegisteredNotify = inngest.createFunction(
  { id: 'tenant-registered-notify', name: 'Email owner on new registration', retries: 2 },
  { event: 'tenant/registered' },
  async ({ event, step, logger }) => {
    const emailConfig: EmailConfig = {
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
    };

    return step.run('notify-owner', async () => {
      const outcome = await notifyOwnerNewSignup(
        emailConfig,
        env.OWNER_NOTIFICATION_EMAIL,
        {
          tenantName: event.data.tenantName,
          userEmail: event.data.userEmail,
          tenantId: event.data.tenantId,
        },
      );
      // Throw only on a transient send error so Inngest retries; config gaps
      // (no owner address / Resend unset) are a deliberate no-op.
      if (!outcome.sent && outcome.reason === 'error') {
        throw new Error(`owner signup mail failed: ${outcome.message ?? 'unknown'}`);
      }
      if (!outcome.sent) {
        logger.info({ reason: outcome.reason }, 'owner signup notification skipped');
      }
      return outcome;
    });
  },
);
