import { createContext, use, useCallback, useRef, useState, type ReactNode } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Button } from './button'

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn | null>(null)

/** Imperative confirm(): `if (await confirm({...})) doTheThing()`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }

  return (
    <ConfirmCtx value={confirm}>
      {children}
      <AlertDialog.Root open={opts !== null} onOpenChange={(o) => !o && settle(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="ipc-overlay fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content className="ipc-dialog fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 shadow-lg">
            <AlertDialog.Title className="text-lg font-semibold">{opts?.title}</AlertDialog.Title>
            {opts?.description && (
              <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                {opts.description}
              </AlertDialog.Description>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" size="sm">
                  {opts?.cancelLabel ?? 'Cancel'}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant={opts?.destructive ? 'destructive' : 'default'}
                  size="sm"
                  onClick={() => settle(true)}
                >
                  {opts?.confirmLabel ?? 'Confirm'}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmCtx>
  )
}

export function useConfirm(): ConfirmFn {
  const v = use(ConfirmCtx)
  if (!v) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return v
}
