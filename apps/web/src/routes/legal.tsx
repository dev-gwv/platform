import { Clock, Mail, MapPin, Phone } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { LegalPage, LegalSection } from '@/features/legal/LegalPage'
import { LEGAL, PLANS, PLAN_SUMMARY } from '@/features/legal/legal'

/**
 * The four public policy pages a payment gateway asks for, about IPC Studios
 * as the software vendor. Plain words, no login needed.
 */

const Email = () => (
  <a href={`mailto:${LEGAL.supportEmail}`} className="font-medium text-primary hover:underline">
    {LEGAL.supportEmail}
  </a>
)

export function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      intro={`These terms apply to your use of ${LEGAL.productName}, run by ${LEGAL.operatorName}. By creating an account or using the service you agree to them.`}
    >
      <LegalSection n={1} title="The service">
        <p>
          {LEGAL.appName} is online software for photography and film studios: projects, shoots, team booking, data custody,
          deliverables, billing and related tools. It is provided as a subscription over the internet.
        </p>
      </LegalSection>
      <LegalSection n={2} title="Accounts">
        <ul>
          <li>Give accurate details when you register, and keep them up to date.</li>
          <li>Keep your password private. You are responsible for what happens under your login.</li>
          <li>A studio owner is responsible for the people they invite and the access they give them.</li>
        </ul>
      </LegalSection>
      <LegalSection n={3} title="Plans and payment">
        <p>{PLAN_SUMMARY}</p>
        <ul>
          <li>Prices are in Indian Rupees. GST is added at checkout.</li>
          <li>Payments are handled by Razorpay. We never see or store your card or bank details.</li>
          <li>A plan starts when the payment succeeds and runs for its full period. Plans do not renew on their own.</li>
          <li>When a plan ends, access pauses until you renew. Your data is kept.</li>
        </ul>
      </LegalSection>
      <LegalSection n={4} title="Fair use">
        <p>You agree not to:</p>
        <ul>
          <li>use the service for anything unlawful;</li>
          <li>try to reach another studio's data, or get around security;</li>
          <li>copy, resell or reverse-engineer the software;</li>
          <li>upload anything harmful, such as malware.</li>
        </ul>
      </LegalSection>
      <LegalSection n={5} title="Your data">
        <p>
          What you put into {LEGAL.appName} — clients, projects, files, records — belongs to you. You give us only the permission
          needed to store it and run the service for you. See the <Link to="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </LegalSection>
      <LegalSection n={6} title="Availability">
        <p>
          We work to keep the service running and your data safe, but we cannot promise it will never be interrupted. Planned
          maintenance is kept short and, where possible, announced.
        </p>
      </LegalSection>
      <LegalSection n={7} title="Our software">
        <p>The software, its design and its name belong to {LEGAL.operatorName}. Your subscription lets you use it; it does not transfer it.</p>
      </LegalSection>
      <LegalSection n={8} title="Liability">
        <p>
          To the extent the law allows, our total liability for any claim is limited to the fees you paid us in the 12 months
          before it. We are not liable for indirect losses such as lost profit or business.
        </p>
      </LegalSection>
      <LegalSection n={9} title="Ending the service">
        <p>
          You can stop using the service at any time. We may suspend an account that breaks these terms. Either way, you can ask
          us for an export of your data.
        </p>
      </LegalSection>
      <LegalSection n={10} title="Law">
        <p>These terms are governed by the laws of {LEGAL.country}.</p>
      </LegalSection>
      <LegalSection n={11} title="Changes">
        <p>We may update these terms. The date at the top shows the latest version; big changes are announced in the app.</p>
      </LegalSection>
      <LegalSection n={12} title="Contact">
        <p>
          Questions: <Email />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This explains what ${LEGAL.operatorName} collects when you use ${LEGAL.appName}, why, and what you can ask us to do with it.`}
    >
      <LegalSection n={1} title="What we collect">
        <ul>
          <li>Account details: name, email, phone, and your studio's name.</li>
          <li>What your studio enters: clients, projects, shoots, team, invoices, files and records.</li>
          <li>Payment details for your subscription: the amount, status and Razorpay reference. Never card or bank numbers.</li>
          <li>Basic technical logs: sign-ins, errors and device type, to keep the service secure and working.</li>
        </ul>
      </LegalSection>
      <LegalSection n={2} title="How we use it">
        <ul>
          <li>To run the service for you and your team.</li>
          <li>To send the emails and notifications the app needs, such as invites, password resets and reminders.</li>
          <li>To handle billing, support and security.</li>
        </ul>
        <p>We do not sell your data, and we do not use it for advertising.</p>
      </LegalSection>
      <LegalSection n={3} title="Who helps us run it">
        <ul>
          <li>Razorpay, for payments.</li>
          <li>Google, if you choose to sign in with Google.</li>
          <li>Our cloud hosting and database providers, where the service and your data run.</li>
          <li>An email delivery service, for app emails, and an error-tracking service, for fixing problems.</li>
        </ul>
        <p>Each gets only what it needs to do its job.</p>
      </LegalSection>
      <LegalSection n={4} title="Keeping it safe">
        <p>
          All traffic is encrypted (HTTPS). Every studio's data is kept apart from every other studio's, and your team sees only
          what your access settings allow.
        </p>
      </LegalSection>
      <LegalSection n={5} title="How long we keep it">
        <p>
          We keep your data while your account exists, including while a plan has lapsed, so nothing is lost when you renew. Ask us
          and we will delete it, apart from what the law requires us to keep, such as payment records.
        </p>
      </LegalSection>
      <LegalSection n={6} title="Your choices">
        <p>
          You can see and correct most of your data in the app. To get a copy, or to have your account deleted, email <Email />.
        </p>
      </LegalSection>
      <LegalSection n={7} title="Cookies">
        <p>We use only what is needed to keep you signed in and remember your settings. No advertising or tracking cookies.</p>
      </LegalSection>
      <LegalSection n={8} title="Children">
        <p>The service is for businesses and is not meant for anyone under 18.</p>
      </LegalSection>
      <LegalSection n={9} title="Changes">
        <p>If this policy changes, the date at the top changes too, and big changes are announced in the app.</p>
      </LegalSection>
      <LegalSection n={10} title="Contact">
        <p>
          Privacy questions: <Email />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}

export function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro={`${LEGAL.appName} is a digital subscription: nothing is shipped, so there is nothing to return. This is when you get your money back.`}
    >
      <LegalSection n={1} title="What you pay for">
        <p>{PLAN_SUMMARY}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{p.name}</p>
              <p className="text-lg font-semibold">{p.price}</p>
              <p className="text-xs text-muted-foreground">{p.period} + GST</p>
            </div>
          ))}
        </div>
      </LegalSection>
      <LegalSection n={2} title="Cancelling">
        <p>
          Plans do not renew on their own, so there is nothing to cancel: a plan simply ends at the end of its period. There is no
          cancellation charge.
        </p>
      </LegalSection>
      <LegalSection n={3} title="When we refund">
        <p>Payments for a plan are not refundable once it is active, except when:</p>
        <ul>
          <li>you were charged twice for the same plan;</li>
          <li>you paid but your plan did not start, and we could not fix it within 7 working days;</li>
          <li>a payment was made without your permission, and Razorpay confirms it.</li>
        </ul>
        <p>Approved refunds go back to the way you paid, usually within 5–10 working days.</p>
      </LegalSection>
      <LegalSection n={4} title="Failed or stuck payments">
        <p>
          If money left your account but the payment failed, your bank or Razorpay returns it on its own, usually within 5–7
          working days. If it has not, write to us.
        </p>
      </LegalSection>
      <LegalSection n={5} title="How to ask">
        <p>
          Email <Email /> within 7 days of the payment, from your registered email, with the date, the amount and the Razorpay
          payment ID. We reply within 3 working days.
        </p>
      </LegalSection>
      <LegalSection n={6} title="Changing plans">
        <p>To move to a different plan part-way through, write to us and we will work it out with you.</p>
      </LegalSection>
    </LegalPage>
  )
}

export function ContactPage() {
  const rows = [
    { icon: Mail, label: 'Email', value: <Email /> },
    LEGAL.phone ? { icon: Phone, label: 'Phone', value: <a href={`tel:${LEGAL.phone}`} className="font-medium text-primary hover:underline">{LEGAL.phone}</a> } : null,
    { icon: Clock, label: 'Reply time', value: LEGAL.responseTime },
    LEGAL.address.length ? { icon: MapPin, label: 'Address', value: LEGAL.address.join(', ') } : null,
  ].filter((r): r is NonNullable<typeof r> => !!r)
  return (
    <LegalPage title="Contact Us" intro="Questions about your account, a payment or anything in the app — we are happy to help.">
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <r.icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <div className="break-words text-sm">{r.value}</div>
            </div>
          </div>
        ))}
      </div>
      <LegalSection title="Payments and billing">
        <p>
          Include your registered email, the date, the amount and the Razorpay payment ID, and we can find it quickly. See also the{' '}
          <Link to="/refund-policy" className="text-primary hover:underline">
            Refund Policy
          </Link>
          .
        </p>
      </LegalSection>
      <LegalSection title="Who runs this service">
        <p>
          {LEGAL.operatorName}, {LEGAL.country}
          {LEGAL.gstin ? ` · GSTIN ${LEGAL.gstin}` : ''}
        </p>
      </LegalSection>
    </LegalPage>
  )
}
