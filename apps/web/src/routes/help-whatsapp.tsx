import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Wordmark } from '@/shared/ui/wordmark'

/**
 * /help/whatsapp — connecting a studio's own WhatsApp Business number
 * (Cloud API) to Studio AutoPilot, step by step. Public, so it can be sent
 * to whoever runs the studio's Facebook and Meta accounts.
 */
const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Have a number that is not on the WhatsApp app',
    body: (
      <>
        Use a phone number that can get an SMS or a call and is <b>not</b> signed in to the WhatsApp or WhatsApp Business app. A number
        already on the app must be removed from it first (WhatsApp → Settings → Account → Delete account). Your chats on the app are
        not moved.
      </>
    ),
  },
  {
    title: 'Open a Meta Business account',
    body: (
      <>
        Go to <b>business.facebook.com</b> and sign in with the Facebook profile that runs your studio's Page. Create a business
        portfolio in your studio's name if you do not have one. Under <b>Business settings → Business info</b>, add your address and
        website; Meta checks these.
      </>
    ),
  },
  {
    title: 'Connect, the easy way',
    body: (
      <>
        In Studio AutoPilot, open <b>Settings → WhatsApp</b> and press <b>Connect with Facebook</b>. Pick your business, add your
        number, type the code Meta sends, and you are done — the next steps are only for the manual way.
      </>
    ),
  },
  {
    title: 'Or the manual way: make a Meta app',
    body: (
      <>
        At <b>developers.facebook.com → My apps → Create app</b>, choose <b>Business</b>, then add the <b>WhatsApp</b> product. Under{' '}
        <b>WhatsApp → API Setup</b>, add your number and verify it with the code Meta sends.
      </>
    ),
  },
  {
    title: 'Copy the two IDs',
    body: (
      <>
        On the same API Setup page, copy the <b>Phone number ID</b> and the <b>WhatsApp Business Account ID</b>. Paste them into{' '}
        <b>Settings → WhatsApp → Connect by hand</b>.
      </>
    ),
  },
  {
    title: 'Make a permanent token',
    body: (
      <>
        In <b>Business settings → Users → System users</b>, add a system user (Admin), assign it your app and your WhatsApp account
        with full control, then <b>Generate new token</b> with the permissions <b>whatsapp_business_messaging</b> and{' '}
        <b>whatsapp_business_management</b>, set to never expire. Paste the token into Studio AutoPilot. It is kept sealed: nobody,
        including us, can read it back.
      </>
    ),
  },
  {
    title: 'So that replies come in',
    body: (
      <>
        Studio AutoPilot then shows a <b>Callback URL</b> and a <b>Verify token</b>. In your Meta app, under{' '}
        <b>WhatsApp → Configuration → Webhook</b>, paste both and subscribe to <b>messages</b>. A client's reply now lands on their
        lead, and a new number becomes a new enquiry.
      </>
    ),
  },
  {
    title: 'Templates, and going live',
    body: (
      <>
        WhatsApp lets a business start a chat only with an approved <b>template</b>. Write yours in WhatsApp Manager → Message
        templates (Meta approves most within a day), then press <b>Sync templates</b> in Studio AutoPilot. Add a payment method in
        WhatsApp Manager — Meta bills conversations to you directly, not through us.
      </>
    ),
  },
]

export function HelpWhatsAppPage() {
  useEffect(() => {
    const before = document.title
    document.title = 'Connect your own WhatsApp number'
    return () => {
      document.title = before
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/dashboard" className="text-lg font-semibold tracking-tight">
            <Wordmark />
          </Link>
          <Link to="/settings/whatsapp" className="text-sm text-muted-foreground hover:text-foreground">
            Open WhatsApp settings
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Connect your own WhatsApp number</h1>
        <p className="mt-1 text-muted-foreground">About 30 minutes, once. Comes with the Studio Max plan.</p>
        <ol className="mt-8 flex flex-col gap-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground tabular-nums">
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold">{s.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}
