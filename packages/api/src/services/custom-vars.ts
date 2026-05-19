/**
 * Resolve a tenant's custom message variables for one apartment.
 *
 * Returns only keys that have a per-apartment value — unset variables are
 * intentionally omitted so renderTemplate leaves `{{key}}` literal (the
 * chosen fallback behaviour).
 */
import { and, eq } from 'drizzle-orm';
import {
  messageVariables,
  messageVariableValues,
  type Database,
} from '@cm/db';

/** Placeholder token rule for custom variables. */
export const CUSTOM_VAR_KEY_RE = /^[a-z][a-zA-Z0-9_]*$/;

export async function resolveCustomVars(
  db: Database,
  tenantId: string,
  propertyId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({
      key: messageVariables.key,
      value: messageVariableValues.value,
    })
    .from(messageVariables)
    .innerJoin(
      messageVariableValues,
      and(
        eq(messageVariableValues.variableId, messageVariables.id),
        eq(messageVariableValues.propertyId, propertyId),
      ),
    )
    .where(eq(messageVariables.tenantId, tenantId));

  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
