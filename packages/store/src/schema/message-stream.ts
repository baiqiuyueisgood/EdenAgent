/** Prevent older hosts from opening data containing independent message/SDK partial deltas. */
export const messageStreamSchema = `INSERT INTO realm_meta(key,value) VALUES ('event_payload_format','eden.message.delta.v2')
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;`
