import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { brandsState, createBrandResponse, type BrandsState } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'

/**
 * Brands on one login (0276, owner 20 Oct): Pro runs up to three studios, a
 * maternity brand beside the wedding one, Studio Max as many as it likes. A
 * brand is a studio of its own on the same plan, opened from Switch studio.
 */
export function useBrands(enabled: boolean) {
  return useQuery({
    queryKey: ['subscription', 'brands'],
    queryFn: () => callApi('/subscription/brands', { responseSchema: brandsState }),
    enabled,
    staleTime: 60_000,
  })
}

/** "2 of 3 brands", "1 brand · no limit", for the line under Add a brand. */
export function brandsLine(b: Pick<BrandsState, 'used' | 'limit'>): string {
  if (b.limit == null) return `${b.used} ${b.used === 1 ? 'brand' : 'brands'} · no limit`
  return `${b.used} of ${b.limit} ${b.limit === 1 ? 'brand' : 'brands'}`
}

/**
 * The account menu's line for it. An owner who may add one gets the button;
 * on a plan that has one studio it says where more come from instead.
 */
export function BrandsMenuItem({ onPicked, onAdd }: { onPicked: () => void; onAdd: () => void }) {
  const { session } = useAuth()
  const brands = useBrands(!!session?.is_owner)
  const b = brands.data
  if (!session?.is_owner || !b?.is_owner) return null

  if (!b.can_add) {
    return (
      <div className="border-t border-border p-1.5">
        <Link
          to="/settings/subscription"
          role="menuitem"
          onClick={onPicked}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
        >
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Add a brand</span>
            <span className="block text-xs text-muted-foreground">
              {b.limit != null && b.limit <= 1 ? 'With Pro (3) or Studio Max (no limit)' : `${brandsLine(b)} · Studio Max for more`}
            </span>
          </span>
        </Link>
      </div>
    )
  }

  return (
    <div className="border-t border-border p-1.5">
      <button
        type="button"
        role="menuitem"
        onClick={onAdd}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
      >
        <Plus className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Add a brand</span>
          <span className="block text-xs text-muted-foreground">{brandsLine(b)}</span>
        </span>
      </button>
    </div>
  )
}

/** Rendered by the account menu outside its panel, so closing the menu never closes it. */
export function AddBrandDialog({ onClose }: { onClose: () => void }) {
  const { switchStudio } = useAuth()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: (n: string) =>
      callApi('/subscription/brands', { method: 'POST', body: { name: n }, responseSchema: createBrandResponse }),
  })
  const ok = name.trim().length >= 2

  const submit = async () => {
    if (!ok || create.isPending) return
    try {
      const { profile_id } = await create.mutateAsync(name.trim())
      toast.success(`${name.trim()} is ready. Opening it now.`)
      await switchStudio(profile_id)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'We could not add the brand. Please try again.')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a brand" description="A studio of its own (leads, projects, team and money), on the same login and plan.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input
              id="brand-name"
              autoFocus
              maxLength={80}
              placeholder="Asha Maternity"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={ok ? 'border-success/50' : 'border-warning/60'}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add brand
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
