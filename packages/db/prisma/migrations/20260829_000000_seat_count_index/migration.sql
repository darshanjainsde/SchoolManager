-- The seat count behind "is there a place left?" filters on ticketTypeId and
-- status. Existing indexes are (schoolId, ticketTypeId) and (eventId, status) —
-- ticketTypeId leads neither, so the count could not seek.
--
-- It matters more than an ordinary read: the count runs inside the transaction
-- that decides whether to admit or waitlist a family, so its cost is paid while
-- holding a row lock on a popular event.
CREATE INDEX "EventRegistration_ticketTypeId_status_idx"
  ON "EventRegistration" ("ticketTypeId", status);
