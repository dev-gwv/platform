import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ledgerEntry,
  marginRow,
  messagingSummary,
  platformOutboxMessage,
  platformPrice,
  platformRechargeRequest,
  platformWallet,
  testMessageResult,
  walletState,
  whatsappTemplate,
  z,
  type CreateRechargeRequest,
  type LedgerSource,
  type MessageChannel,
  type MessageStatus,
  type PlatformAdjustRequest,
  type PlatformCreditRequest,
  type PlatformSetPrice,
  type RechargeStatus,
  type SaveWhatsappTemplate,
  type UpdateMessagingSettings,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const idOnly = z.object({ id: z.string() })
const none = z.unknown()

// ── studio (owner) ───────────────────────────────────────────────

export function useMessaging() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['messaging', 'summary'],
    queryFn: () => callApi('/messaging', { responseSchema: messagingSummary }),
    enabled: !!session?.is_owner,
    staleTime: 30_000,
  })
}

/** Just the balance: the dashboard banner. Owner only. */
export function useWallet() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['messaging', 'wallet'],
    queryFn: () => callApi('/messaging/wallet', { responseSchema: walletState }),
    enabled: !!session?.is_owner,
    staleTime: 5 * 60_000,
  })
}

export function useLedger(filters: { source?: LedgerSource | ''; from?: string; to?: string }) {
  const { session } = useAuth()
  const qs = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => !!e[1]),
  ).toString()
  return useQuery({
    queryKey: ['messaging', 'ledger', qs],
    queryFn: () => callApi(`/messaging/ledger${qs ? `?${qs}` : ''}`, { responseSchema: ledgerEntry.array() }),
    enabled: !!session?.is_owner,
    staleTime: 30_000,
  })
}

function useMessagingMutation<T>(fn: (v: T) => Promise<unknown>, done: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (done) toast.success(done)
      void qc.invalidateQueries({ queryKey: ['messaging'] })
    },
  })
}

export const useRequestRecharge = () =>
  useMessagingMutation(
    (body: CreateRechargeRequest) => callApi('/messaging/recharge-requests', { method: 'POST', body, responseSchema: idOnly }),
    'Request sent. We will add the money once the payment is confirmed.',
  )

export const useCancelRecharge = () =>
  useMessagingMutation(
    (id: string) => callApi(`/messaging/recharge-requests/${id}/cancel`, { method: 'POST', body: {}, responseSchema: none }),
    'Request cancelled',
  )

export const useSaveMessagingSettings = () =>
  useMessagingMutation(
    (body: UpdateMessagingSettings) => callApi('/messaging/settings', { method: 'PATCH', body, responseSchema: none }),
    null,
  )

export function useSendTest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (channel: MessageChannel) =>
      callApi('/messaging/test', { method: 'POST', body: { channel }, responseSchema: testMessageResult }),
    onSuccess: (r) => {
      if (r.status === 'queued') toast.success('Test message queued. It goes out within a few minutes.')
      else if (r.status === 'skipped_no_balance') toast.error('Not sent: recharge to send WhatsApp messages.')
      else toast.error(r.error ?? 'The test message could not be sent.')
      void qc.invalidateQueries({ queryKey: ['messaging'] })
    },
  })
}

// ── platform console ─────────────────────────────────────────────

function usePlatformQuery<T extends z.ZodTypeAny>(key: string[], path: string, schema: T) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform', 'messaging', ...key],
    queryFn: () => callApi(path, { responseSchema: schema }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

export const usePlatformMessagingStatus = () =>
  usePlatformQuery(['status'], '/platform/messaging/status', z.object({ whatsapp_live: z.boolean(), email_live: z.boolean(), webhook_signed: z.boolean() }))
export const usePlatformWallets = () => usePlatformQuery(['wallets'], '/platform/messaging/wallets', platformWallet.array())
export const usePlatformRequests = (status: RechargeStatus | null) =>
  usePlatformQuery(['requests', status ?? 'all'], `/platform/messaging/requests${status ? `?status=${status}` : ''}`, platformRechargeRequest.array())
export const usePlatformPrices = () => usePlatformQuery(['prices'], '/platform/messaging/prices', platformPrice.array())
export const usePlatformTemplates = () => usePlatformQuery(['templates'], '/platform/messaging/templates', whatsappTemplate.array())
export const usePlatformOutbox = (status: MessageStatus | null) =>
  usePlatformQuery(['outbox', status ?? 'all'], `/platform/messaging/outbox${status ? `?status=${status}` : ''}`, platformOutboxMessage.array())
export const usePlatformMargin = (months: number) =>
  usePlatformQuery(['margin', String(months)], `/platform/messaging/margin?months=${months}`, marginRow.array())

function usePlatformMutation<T>(fn: (v: T) => Promise<unknown>, done: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(done)
      void qc.invalidateQueries({ queryKey: ['platform', 'messaging'] })
    },
  })
}

export const useCreditWallet = () =>
  usePlatformMutation(
    (body: PlatformCreditRequest) => callApi('/platform/messaging/credit', { method: 'POST', body, responseSchema: idOnly }),
    'Wallet credited',
  )
export const useAdjustWallet = () =>
  usePlatformMutation(
    (body: PlatformAdjustRequest) => callApi('/platform/messaging/adjust', { method: 'POST', body, responseSchema: idOnly }),
    'Wallet adjusted',
  )
export const useSetOverdraft = () =>
  usePlatformMutation(
    (body: { company_id: string; overdraft_paise: number }) =>
      callApi('/platform/messaging/overdraft', { method: 'POST', body, responseSchema: none }),
    'Overdraft saved',
  )
export const useRejectRecharge = () =>
  usePlatformMutation(
    ({ id, note }: { id: string; note?: string }) =>
      callApi(`/platform/messaging/requests/${id}/reject`, { method: 'POST', body: note ? { note } : {}, responseSchema: none }),
    'Request closed',
  )
export const useSetPrice = () =>
  usePlatformMutation(
    (body: PlatformSetPrice) => callApi('/platform/messaging/prices', { method: 'POST', body, responseSchema: idOnly }),
    'Price saved. It applies to new messages from now.',
  )
export const useSaveTemplate = () =>
  usePlatformMutation(
    (body: SaveWhatsappTemplate) => callApi('/platform/messaging/templates', { method: 'PUT', body, responseSchema: idOnly }),
    'Template saved',
  )
