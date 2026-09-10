import { Card, CardContent, Skeleton } from "~/components/ui";
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8"
      role="status"
      aria-label="Loading page"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="space-y-4 pt-6">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-11 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading Skill Passport</span>
    </div>
  );
}
