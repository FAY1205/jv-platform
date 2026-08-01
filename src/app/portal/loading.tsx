import { Card, CardBody, Skeleton } from "@/components";

// Route-level fallback for the portal's force-dynamic server pages (Account, Dashboard),
// which await the scope + ToS gate before their client body mounts. Renders inside the
// PortalShell (from portal/layout.tsx), so this is only the main-area placeholder. A
// generic, subtle shape that suits either landing page.
export default function LoadingPortal() {
  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      <Skeleton className="mb-4 h-6 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="flex flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-12" />
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="mt-4">
        <Card>
          <CardBody className="flex flex-col gap-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
