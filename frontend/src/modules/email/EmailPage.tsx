import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BulkSendTab } from './BulkSendTab'
import { ComposeDialog, type ComposeMode } from './ComposeDialog'
import { DraftsList } from './DraftsList'
import { EmailSidebar, type EmailView } from './EmailSidebar'
import { MailboxView } from './MailboxView'
import { SentTab } from './SentTab'
import { SequencesTab } from './SequencesTab'
import { SettingsTab } from './SettingsTab'
import { TemplatesTab } from './TemplatesTab'
import { PageHeader } from '@/shared/components/PageHeader'
import type { EmailDraft, EmailFolder, EmailMessage, EmailThread } from '@/shared/lib/types'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'

function viewFromParams(params: URLSearchParams): EmailView {
  const kind = params.get('view') ?? 'mailbox'
  if (kind === 'drafts' || kind === 'sent' || kind === 'templates' || kind === 'bulk' || kind === 'sequences' || kind === 'settings') {
    return { kind }
  }
  const folderParam = params.get('folder') as EmailFolder | 'all' | null
  const starred = params.get('starred') === '1'
  const snoozed = params.get('snoozed') === '1'
  const labelId = params.get('labelId') ?? undefined
  // Default pe Inbox DOAR pt. view-ul gol (fără niciun param) — o navigare explicită spre
  // Marcate/o etichetă nu trebuie să capete implicit folder=inbox, altfel un mesaj arhivat
  // (dar cu stea sau etichetat) dispare din acel view (bug găsit de Stefan, 2026-07-17).
  const folder = folderParam ?? (starred || labelId ? undefined : 'inbox')
  return { kind: 'mailbox', folder, starred, snoozed, labelId }
}

function paramsFromView(view: EmailView): URLSearchParams {
  const p = new URLSearchParams()
  if (view.kind !== 'mailbox') {
    p.set('view', view.kind)
    return p
  }
  if (view.folder) p.set('folder', view.folder)
  if (view.starred) p.set('starred', '1')
  if (view.snoozed) p.set('snoozed', '1')
  if (view.labelId) p.set('labelId', view.labelId)
  return p
}

export function EmailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [compose, setCompose] = useState<{ open: boolean; mode: ComposeMode }>({ open: false, mode: { kind: 'compose' } })

  const view = viewFromParams(searchParams)

  const navigate = (next: EmailView) => {
    setSearchParams(paramsFromView(next))
    setSidebarOpen(false)
  }

  const openCompose = (mode: ComposeMode) => setCompose({ open: true, mode })

  // Deschidere directă din alte pagini (ex: click pe email în Prospectare) — /email?to=x@y.ro.
  // Consumat o singură dată la montare, apoi scos din URL ca refresh/back să nu re-deschidă compose.
  useEffect(() => {
    const to = searchParams.get('to')
    if (!to) return
    openCompose({ kind: 'compose', to })
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('to')
      return next
    })
    // Consumat o singură dată la montare — dependențele (searchParams/setSearchParams) sunt
    // stabile din react-router, includerea lor ar re-declanșa efectul la fiecare navigare internă.
  }, [])

  useConsumeParam('compose', () => openCompose({ kind: 'compose' }))

  const handleReply = (thread: EmailThread, lastInbound: EmailMessage) => {
    // toAddress = adresa reală pe care a venit mesajul (stefan@/contact@) — determină ce
    // semnătură se pune la trimitere (server, replyToThread); dus mai departe doar ca
    // Compose să poată previzualiza semnătura corectă, nu presupune 'stefan' implicit.
    openCompose({
      kind: 'reply',
      threadId: thread.id,
      to: lastInbound.fromAddress,
      subject: thread.subject,
      fromAddress: lastInbound.toAddress,
      // Ultimul mesaj văzut de om: dacă altcineva răspunde până trimite, serverul întoarce
      // 409 și bara de sub compunere arată cine (fișa „Email cu cutii comune").
      lastSeenMessageId: lastInbound.id,
    })
  }
  const handleForward = (message: EmailMessage) => {
    openCompose({ kind: 'forward', messageId: message.id, subject: message.subject, fromAddress: message.toAddress })
  }
  const handleOpenDraft = (draft: EmailDraft) => openCompose({ kind: 'draft', draft })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email"
        actions={
          <button className="rounded-md border p-2 md:hidden" onClick={() => setSidebarOpen((v) => !v)}>
            <Menu className="h-4 w-4" />
          </button>
        }
      />

      <div className="flex gap-6">
        <div className={sidebarOpen ? 'block' : 'hidden md:block'}>
          <EmailSidebar current={view} onNavigate={navigate} onCompose={() => openCompose({ kind: 'compose' })} />
        </div>

        <div className="min-w-0 flex-1">
          {view.kind === 'mailbox' ? <MailboxView view={view} onReply={handleReply} onForward={handleForward} /> : null}
          {view.kind === 'drafts' ? <DraftsList onOpen={handleOpenDraft} /> : null}
          {view.kind === 'sent' ? <SentTab /> : null}
          {view.kind === 'templates' ? <TemplatesTab /> : null}
          {view.kind === 'bulk' ? <BulkSendTab /> : null}
          {view.kind === 'sequences' ? <SequencesTab /> : null}
          {view.kind === 'settings' ? <SettingsTab /> : null}
        </div>
      </div>

      <ComposeDialog open={compose.open} onOpenChange={(open) => setCompose((c) => ({ ...c, open }))} mode={compose.mode} />
    </div>
  )
}
