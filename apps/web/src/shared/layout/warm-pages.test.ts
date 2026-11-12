import { describe, expect, it } from 'vitest'
import { Home, Wallet } from 'lucide-react'
import { menuTargets } from './warm-pages'
import type { NavEntry } from './nav'

describe('pages warmed after sign-in', () => {
  it('lists every menu page once, hub tabs and group children included', () => {
    const entries = [
      { kind: 'leaf', label: 'Home', to: '/dashboard', icon: Home },
      { kind: 'leaf', label: 'Money', to: '/payments', icon: Wallet, hub: [{ to: '/payments', label: 'Payments' }, { to: '/invoices', label: 'Invoices' }] },
      { kind: 'group', label: 'Team', match: '/team', children: [{ kind: 'leaf', label: 'People', to: '/employees', icon: Home }] },
    ] as unknown as NavEntry[]
    expect(menuTargets(entries)).toEqual(['/dashboard', '/payments', '/invoices', '/employees'])
  })
})
