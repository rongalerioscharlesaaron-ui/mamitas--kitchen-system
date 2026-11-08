import { query } from '../config/db.js';

// Writes one row to the activity log. A failure here is logged but never breaks the request.
export async function audit({
  userId = null,
  username = null,
  action,
  entity = null,
  entityId = null,
  details = {},
  ip = null,
}) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, username, action, entity, entityId == null ? null : String(entityId), JSON.stringify(details), ip]
    );
  } catch (err) {
    console.error('Activity log write failed:', err.message);
  }
}