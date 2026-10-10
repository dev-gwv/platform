import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { helpContent, type HelpFaq } from '@ipc/contracts'
import { useAddFaq, useDeleteFaq, useDeleteHelpVideo, useEditFaq, useSaveHelpContacts, useSaveHelpVideo } from '@/features/help/api'
import { SHIPPED, TUTORIALS } from '@/features/help/tutorials'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AssistantHealthCard } from '@/features/assistant/AssistantHealthCard'
import { AssistantSettingsCard } from '@/features/assistant/AssistantSettingsCard'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'

export function PlatformHelpPage() {
  return (
    <PlatformPage>
      <HelpConsole />
    </PlatformPage>
  )
}

/** What the Help panel and /help show: who to reach, the answers, the videos. */
function HelpConsole() {
  const { session } = useAuth()
  const help = useQuery({
    queryKey: ['help'],
    queryFn: () => callApi('/platform/help', { responseSchema: helpContent }),
    enabled: !!session,
  })

  return (
    <>
      <PageHeader title="Help" />
      {help.isLoading ? (
        <SkeletonList rows={4} />
      ) : help.isError || !help.data ? (
        <ErrorState onRetry={() => void help.refetch()} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">
          <Contacts whatsapp={help.data.support_whatsapp} email={help.data.support_email} />
          <AssistantSettingsCard />
          <AssistantHealthCard />
          <Faqs faqs={help.data.faqs} />
          <Videos videos={help.data.videos} />
        </div>
      )}
    </>
  )
}

const filled = (v: string) => (v.trim() ? 'border-success/60' : 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/20')

function Contacts({ whatsapp, email }: { whatsapp: string | null; email: string | null }) {
  const [wa, setWa] = useState(whatsapp ?? '')
  const [mail, setMail] = useState(email ?? '')
  useEffect(() => {
    setWa(whatsapp ?? '')
    setMail(email ?? '')
  }, [whatsapp, email])
  const save = useSaveHelpContacts()
  const changed = wa !== (whatsapp ?? '') || mail !== (email ?? '')

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="font-semibold">Who studios reach</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          WhatsApp number, with country code
          <Input className={filled(wa)} inputMode="tel" placeholder="e.g. 91 98765 43210" value={wa} onChange={(e) => setWa(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <Input className={filled(mail)} type="email" placeholder="e.g. help@studioautopilot.in" value={mail} onChange={(e) => setMail(e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">
          {wa.trim() || mail.trim() ? 'Help shows a button for each one that is filled.' : 'Help shows no contact button until one is filled.'}
        </p>
        <Button
          className="self-start"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate({ support_whatsapp: wa.trim() || null, support_email: mail.trim() || null })}
        >
          Save contacts
        </Button>
      </CardContent>
    </Card>
  )
}

function Faqs({ faqs }: { faqs: HelpFaq[] }) {
  const [adding, setAdding] = useState(false)
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Questions studios ask · {faqs.length}</p>
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus /> Add question
          </Button>
        </div>
        {adding && <FaqForm onDone={() => setAdding(false)} />}
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {faqs.map((f) => (
            <FaqRow key={f.id} faq={f} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function FaqRow({ faq }: { faq: HelpFaq }) {
  const [editing, setEditing] = useState(false)
  const remove = useDeleteFaq()
  if (editing) return <div className="p-3"><FaqForm faq={faq} onDone={() => setEditing(false)} /></div>
  return (
    <div className="flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{faq.question}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{faq.answer}</p>
      </div>
      <Button size="icon" variant="outline" aria-label="Edit question" onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="outline"
        aria-label="Remove question"
        className="hover:border-destructive hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => {
          if (window.confirm(`Remove "${faq.question}"?`)) remove.mutate(faq.id)
        }}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function FaqForm({ faq, onDone }: { faq?: HelpFaq; onDone: () => void }) {
  const [q, setQ] = useState(faq?.question ?? '')
  const [a, setA] = useState(faq?.answer ?? '')
  const add = useAddFaq()
  const edit = useEditFaq()
  const busy = add.isPending || edit.isPending
  const save = () => {
    const body = { question: q.trim(), answer: a.trim() }
    if (faq) edit.mutate({ id: faq.id, ...body }, { onSuccess: onDone })
    else add.mutate(body, { onSuccess: onDone })
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Input className={filled(q)} placeholder="The question, as a studio would ask it" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <Textarea className={cn('min-h-24', filled(a))} placeholder="The answer, in plain words" value={a} onChange={(e) => setA(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || q.trim().length < 3 || !a.trim()} onClick={save}>
          {faq ? 'Save' : 'Add question'}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Videos({ videos }: { videos: { page_key: string; title: string; url: string }[] }) {
  const byKey = new Map(videos.map((v) => [v.page_key, v]))
  const extra = videos.filter((v) => !TUTORIALS.some((t) => t.key === v.page_key))
  const [adding, setAdding] = useState(false)
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Tutorials</p>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
            <Plus /> Video for another page
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">A link here replaces the built-in video. Remove it to go back.</p>
        {adding && <VideoForm onDone={() => setAdding(false)} />}
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {TUTORIALS.map((t) => (
            <VideoRow
              key={t.key}
              pageKey={t.key}
              title={t.title}
              builtIn={SHIPPED.includes(t.key)}
              video={byKey.get(t.key)}
            />
          ))}
          {extra.map((v) => (
            <VideoRow key={v.page_key} pageKey={v.page_key} title={v.title} builtIn={false} video={v} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function VideoRow({ pageKey, title, builtIn, video }: { pageKey: string; title: string; builtIn: boolean; video?: { title: string; url: string } | undefined }) {
  const [editing, setEditing] = useState(false)
  const remove = useDeleteHelpVideo()
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{video?.title ?? title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {video ? video.url : builtIn ? 'Built-in video' : 'No video yet'}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            video ? 'bg-tone-violet/15 text-tone-violet' : builtIn ? 'bg-success/15 text-success' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
          )}
        >
          {video ? 'Your link' : builtIn ? 'Built-in' : 'Missing'}
        </span>
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {video ? 'Change' : 'Add link'}
        </Button>
        {video && (
          <Button
            size="icon"
            variant="outline"
            aria-label="Remove link"
            className="hover:border-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(pageKey)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {editing && <VideoForm pageKey={pageKey} title={video?.title ?? title} url={video?.url} onDone={() => setEditing(false)} />}
    </div>
  )
}

function VideoForm({ pageKey, title, url, onDone }: { pageKey?: string; title?: string; url?: string | undefined; onDone: () => void }) {
  const [key, setKey] = useState(pageKey ?? '')
  const [t, setT] = useState(title ?? '')
  const [u, setU] = useState(url ?? '')
  const save = useSaveHelpVideo()
  const keyOk = /^[a-z][a-z0-9-]{1,40}$/.test(key)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {!pageKey && (
        <Input className={filled(key)} placeholder="Page name, e.g. invoices" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} />
      )}
      <Input className={filled(t)} placeholder="Title, e.g. Send an invoice" value={t} onChange={(e) => setT(e.target.value)} />
      <Input className={filled(u)} placeholder="https://… (an .mp4 link)" value={u} onChange={(e) => setU(e.target.value)} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={save.isPending || !keyOk || t.trim().length < 2 || !u.trim().startsWith('https://')}
          onClick={() => save.mutate({ key, title: t.trim(), url: u.trim() }, { onSuccess: onDone })}
        >
          Save video
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
