"use client";

import { Card, CardBody, PortalDevices } from "@/components";

// ACC-02: the partner's remembered devices, each revocable. The list/mutation logic now
// lives in the shared PortalDevices component (src/components/PortalDevices.tsx, WP-PW-4
// Task 2) — this page is the thin mobile wrapper: <main> + md:hidden h1 + Card/CardBody
// frame, unchanged from before the extraction.
export default function PortalDevicesPage() {
  return (
    <main className="mx-auto w-full flex-1 p-4">
      <h1 className="mb-4 font-display text-xl font-semibold tracking-tight text-text md:hidden">Your devices</h1>
      <Card>
        <CardBody>
          <PortalDevices />
        </CardBody>
      </Card>
    </main>
  );
}
