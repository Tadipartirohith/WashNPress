// Additional-service actions — the same gates Web's BookingModal uses.
// Cancel is only for a booking that has not started (requested / assigned).
// An in-progress job is completed, not cancelled.

export function serviceCancelAllowed(status: string | null | undefined): boolean {
  return status === "requested" || status === "assigned";
}
