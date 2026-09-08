"use client";

import { ServiceBookingsView } from "@/components/portal/service-bookings";
import { adminApi } from "@/lib/api/admin";

// I-82: Admin → Additional Services. Every resident additional-service booking across
// every society — scheduled, today's, upcoming, completed, cancelled — read-only, with
// a details drawer. The catalogue (creating/pricing services) stays under Catalogue;
// this is the bookings made against it.
export function ServicesSection() {
  return (
    <ServiceBookingsView
      title="Additional Services"
      subtitle="Every additional-service booking residents have made, across all societies."
      showSociety
      fetcher={(filters) => adminApi.serviceRequests(filters)}
    />
  );
}
