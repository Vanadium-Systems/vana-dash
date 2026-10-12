import { AlertTriangle, Inbox } from 'lucide-react'
import { Skeleton } from '@/shared/components/ui/skeleton'

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return <Skeleton style={{ height }} className="w-full animate-in fade-in-0 duration-150" />
}

export function ChartError({ message }: { message: string }) {
  return (
    <div className="flex h-[300px] animate-in flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground fade-in-0 duration-150">
      <AlertTriangle className="h-6 w-6" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

export function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[300px] animate-in flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground fade-in-0 duration-150">
      <Inbox className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
