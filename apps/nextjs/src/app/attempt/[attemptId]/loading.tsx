import { Card, CardContent, Skeleton } from "~/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Skeleton className="h-4 w-40" />
      <Card>
        <CardContent className="space-y-3 pt-5">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-9 w-36" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 pt-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-40" />
        </CardContent>
      </Card>
      <span className="sr-only" role="status">
        Loading interview
      </span>
    </div>
  );
}
