"use client";

import { ServiceBookingsView, type ServiceBookingRow } from "@/components/portal/service-bookings";
import { supervisorApi } from "@/lib/api/supervisor";

// I-82: Supervisor → Additional Services. The resident additional-service bookings in
// this supervisor's societies — scheduled, today's, upcoming, completed, cancelled —
// read-only with a details drawer, so the supervisor can quickly see what is booked
// and who is working it. Reads the same records as the Admin view (listForStaff).
export function ServicesTab() {
  return (
    <ServiceBookingsView
      title="Additional Services"
      subtitle="Additional-service bookings across your societies."
      fetcher={async (filters) => {
        const r = await supervisorApi.services({
          status: filters.status, offeringId: filters.offeringId,
          from: filters.from, to: filters.to,
        });
        return {
          requests: r.requests as ServiceBookingRow[],
          offerings: r.offerings as { id: string; name: string }[],
        };
      }}
    />
  );
}
