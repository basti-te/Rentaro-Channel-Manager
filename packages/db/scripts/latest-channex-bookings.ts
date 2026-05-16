/** Show the most recent OTA-sourced bookings ingested from Channex. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc, isNotNull } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { bookings } from '../src/schema';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(sql);

try {
  const rows = await db
    .select({
      channexBookingId: bookings.channexBookingId,
      source: bookings.source,
      status: bookings.status,
      guestName: bookings.guestName,
      checkin: bookings.checkin,
      checkout: bookings.checkout,
      otaName: bookings.otaName,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(isNotNull(bookings.channexBookingId))
    .orderBy(desc(bookings.createdAt))
    .limit(5);

  if (rows.length === 0) {
    console.log('No Channex-sourced bookings yet.');
  } else {
    for (const b of rows) {
      console.log(`${b.channexBookingId}  ${b.source}/${b.status}  ${b.guestName ?? '?'}  ${b.checkin} → ${b.checkout}  (ota=${b.otaName ?? '?'})`);
    }
  }
} finally {
  await sql.end();
}
