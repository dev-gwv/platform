import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Briefcase, Inbox, IndianRupee, Plus, Wallet } from 'lucide-react'
import { useAccess } from '../auth/useAccess'
import { RowMenu, type RowMenuItem } from '../ui/row-menu'
import { AddLeadDialog } from '@/features/crm/AddLeadDialog'
import { ReceivedPaymentDialog } from '@/features/billing/ReceivedPaymentDialogs'
import { AddExpenseDialog } from '@/features/expenses/ExpenseDialog'

type Making = 'lead' | 'payment' | 'expense' | null

/**
 * "+ New" in the top bar: the four things a studio makes every day, from any
 * page. Add lead used to live only on the Leads page, and a payment or an
 * expense meant finding its page first. Each opens the same dialog its own
 * page uses; a project opens the Create project wizard.
 */
export function NewMenu() {
  const access = useAccess()
  const navigate = useNavigate()
  const [making, setMaking] = useState<Making>(null)

  const items: RowMenuItem[] = []
  if (access.hasAction('crm', 'create'))
    items.push({ label: 'Lead', icon: <Inbox />, onSelect: () => setMaking('lead') })
  if (access.hasAction('projects', 'create'))
    items.push({ label: 'Project', icon: <Briefcase />, onSelect: () => void navigate({ to: '/projects/new' }) })
  if (access.hasAction('billing', 'create'))
    items.push({ label: 'Payment received', icon: <IndianRupee />, onSelect: () => setMaking('payment') })
  if (access.hasAction('company_expenses', 'create'))
    items.push({ label: 'Expense', icon: <Wallet />, onSelect: () => setMaking('expense') })
  if (items.length === 0) return null

  return (
    <>
      {/* Compact on a phone: the plus alone. */}
      <RowMenu items={items} label="Make something new" variant="default" className="shrink-0 whitespace-nowrap">
        <Plus aria-hidden />
        <span className="hidden sm:inline">New</span>
      </RowMenu>
      {making === 'lead' && (
        <AddLeadDialog hideTrigger open onOpenChange={(o) => !o && setMaking(null)} />
      )}
      {making === 'payment' && <ReceivedPaymentDialog open onOpenChange={(o) => !o && setMaking(null)} />}
      {making === 'expense' && (
        <AddExpenseDialog defaultOpen trigger={<span hidden />} onClosed={() => setMaking(null)} />
      )}
    </>
  )
}
