import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from './cn'

export const Tabs = TabsPrimitive.Root
export const TabsList = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  // Scrolls sideways rather than widening the page when the tabs outgrow a
  // phone (Settings → Invoicing, audit 17 Nov).
  <TabsPrimitive.List className={cn('inline-flex h-9 max-w-full items-center justify-start overflow-x-auto rounded-lg bg-muted p-1', className)} {...props} />
)
export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow',
      className,
    )}
    {...props}
  />
)
export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />
)
