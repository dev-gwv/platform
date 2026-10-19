import { Link, useNavigate } from '@tanstack/react-router'
import { QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { firstWord, partnerCounts } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { useEnquiryHub, useMakeVendorQr, usePartner, usePartnerVendors } from './api'
import { QrDownloadButtons, QrImage } from './parts'

/**
 * A vendor's enquiry QR (spec 3.8), on the vendor itself: make one in a tap,
 * or see theirs with its counts and the way to their page. Owners and
 * managers only; nothing for an archived vendor.
 */
export function VendorQrCard({ vendorId, name }: { vendorId: string; name: string }) {
  const hub = useEnquiryHub()
  const canManage = hub.data?.can_manage ?? false
  const vendors = usePartnerVendors(canManage)
  const partnerId = vendors.data?.find((v) => v.id === vendorId)?.partner_id ?? ''
  const partner = usePartner(partnerId)
  const make = useMakeVendorQr()
  const navigate = useNavigate()
  if (!canManage || vendors.isPending) return null

  const p = partner.data
  if (!partnerId || !p) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
          <QrCode className="size-5 text-primary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Enquiry QR code</p>
          <p className="text-xs text-muted-foreground">
            Give {name} their own QR code for their counter. Enquiries from it are marked as theirs.
          </p>
        </div>
        <Button
          size="sm"
          type="button"
          disabled={make.isPending}
          onClick={() =>
            make.mutate(vendorId, {
              onSuccess: (made) => {
                toast.success(`QR code made for ${name}`)
                void navigate({ to: '/follow-ups/partners/$id', params: { id: made.id } })
              },
            })
          }
        >
          <QrCode /> Make their QR code
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-start">
      <span className="mx-auto w-32 shrink-0 rounded-xl border border-border bg-white p-1.5 sm:mx-0">
        <QrImage url={p.form_url} label={`QR code for ${p.name}`} />
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-semibold">Enquiry QR code</p>
        <p className="text-xs text-muted-foreground">
          {partnerCounts(p.scans, p.enquiries, p.booked)} through {firstWord(p.name)}'s QR code.
        </p>
        <QrDownloadButtons url={p.form_url} studio={hub.data?.studio ?? ''} partner={p.name} small />
        <Link to="/follow-ups/partners/$id" params={{ id: p.id }} className="text-sm font-semibold text-primary hover:underline">
          Their enquiries and page →
        </Link>
      </div>
    </div>
  )
}
