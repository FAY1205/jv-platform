import { AppShell, Card, CardBody, CardHeader, Skeleton } from "@/components";

// Route-level fallback for the admin lead detail page (a force-dynamic server
// component that awaits a DB join). Without it, navigation blanks until the query
// returns. Mirrors the real page's shape so the transition reads as the same screen
// filling in, not a flash of empty chrome.
export default function LoadingAdminLead() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl">
        <Skeleton className="mb-4 h-4 w-28" />
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
