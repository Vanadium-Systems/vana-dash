import { Archive, ArchiveRestore, Calculator, CircleSlash, ListPlus, MessageSquareShare, MessagesSquare, Send, UserCheck, UserPlus, Users, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddToSequenceDialog, type SequenceTarget } from '@/modules/pricing/AddToSequenceDialog'
import { PromoteProspectDialog } from '@/modules/pricing/PromoteProspectDialog'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { RowActions, type RowAction } from '@/shared/components/ui/row-actions'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { AddToListDialog } from '../lists/AddToListDialog'
import { useStatuses } from '../prospects/use-prospect-data'
import { ActivityTab } from './ActivityTab'
import { DiscussedTab } from './DiscussedTab'
import { NextStep } from './NextStep'
import { NotesTab } from './NotesTab'
import { Offer } from './Offer'
import { PeopleSection, type ContactKind } from './PeopleSection'
import { Properties } from './Properties'
import { firstReachable } from './reach'
import { ScheduleDialog } from './ScheduleDialog'
import { SheetHeader } from './SheetHeader'
import { Signals } from './Signals'
import { StageBar } from './StageBar'
import { TasksTab, isOpenTask } from './TasksTab'
import { CollaboratorsDialog, ContactCheckDialog, DiscussDialog, RequestDialog, TransferDialog } from './TeamDialogs'
import { TeamBanner } from './TeamBanner'
import type { ProspectSheet } from './types'
import { useNotes, useTasks, useTimeline, useWrite } from './use-sheet'
import { useVoiceNotes } from './voice/voice-api'
import { useTeamActions } from './use-team-actions'

type TabKey = 'activity' | 'notes' | 'tasks' | 'emails' | 'calls' | 'discussed'

export function SheetBody({ sheet }: { sheet: ProspectSheet }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { can, session } = useMe()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const write = useWrite()
  const team = useTeamActions(sheet.id)
  const statuses = useStatuses().data ?? []
  const notes = useNotes(sheet.id)
  const voices = useVoiceNotes(sheet.id)
  const tasks = useTasks(sheet.id)
  const timeline = useTimeline(sheet.id)

  const [tab, setTab] = useState<TabKey>('activity')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [requestKind, setRequestKind] = useState<'transfer' | 'access' | null>(null)
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false)
  const [discussOpen, setDiscussOpen] = useState(false)
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [sequenceTargets, setSequenceTargets] = useState<SequenceTarget[]>([])
  // KM10: the action waits here while the person reads whose prospect it is.
  const [gated, setGated] = useState<{ run: () => void } | null>(null)

  const meId = session?.user.id ?? ''
  const isOwner = sheet.assignedUserId === meId
  const canReassign = can('clienti.repartizare')
  const canClaim = can('clienti.prospectare')
  const manages = Boolean(sheet.assignedUserId) && (isOwner || canReassign)
  const someoneElses = Boolean(sheet.assignedUserId) && !isOwner
  const phone = firstReachable(sheet, 'phone')
  const email = firstReachable(sheet, 'email')

  const gate = (run: () => void) => (someoneElses ? setGated({ run }) : run())
  const contact = (kind: ContactKind, value: string) =>
    gate(() => {
      if (kind === 'call') window.location.href = `tel:${value}`
      else navigate(`/email?to=${encodeURIComponent(value)}`)
    })

  const sequenceTarget = (): SequenceTarget => ({ id: sheet.id, name: sheet.name, email: email?.value ?? null, contactName: sheet.people[0]?.name ?? null })
  const mineRequested = sheet.pendingRequests.some((request) => request.requestedByUserId === meId)

  const menu: RowAction[] = [
    { key: 'sequence', icon: Workflow, label: t('clients:sheet.menu.sequence'), disabled: !email, onClick: () => gate(() => setSequenceTargets([sequenceTarget()])) },
    // Adding to a list is a write (`clienti.prospectare`), the same right as claiming.
    ...(canClaim ? [{ key: 'list', icon: ListPlus, label: t('clients:sheet.menu.addToList'), onClick: () => setListOpen(true) }] : []),
    ...(canShare ? [{ key: 'share', icon: MessageSquareShare, label: t('messages:share.action'), onClick: () => share({ type: 'prospect' as const, id: sheet.id, title: sheet.name }) }] : []),
    ...(someoneElses && can('mesaje.view') ? [{ key: 'discuss', icon: MessagesSquare, label: t('clients:sheet.menu.discuss'), onClick: () => setDiscussOpen(true) }] : []),
    ...(manages ? [{ key: 'transfer', icon: Send, label: t('clients:sheet.menu.transfer'), onClick: () => setTransferOpen(true) }] : []),
    ...(someoneElses && !manages && canClaim && !mineRequested ? [{ key: 'request', icon: UserCheck, label: t('clients:sheet.team.requestTransfer'), onClick: () => setRequestKind('transfer') }] : []),
    ...(manages
      ? [
          {
            key: 'release',
            icon: CircleSlash,
            label: t('clients:sheet.menu.release'),
            onClick: () =>
              void confirm({ title: t('clients:sheet.team.releaseTitle', { name: sheet.name }), consequence: t('clients:sheet.team.releaseBody'), confirmLabel: t('clients:sheet.menu.release') }).then((ok) => ok && team.release()),
          },
        ]
      : []),
    { key: 'collaborators', icon: Users, label: t('clients:sheet.menu.collaborators'), onClick: () => setCollaboratorsOpen(true) },
    ...(!sheet.billingClientId && sheet.canEdit && can('facturi.clienti') ? [{ key: 'promote', icon: UserPlus, label: t('pricing:prospects.promote'), onClick: () => setPromoteOpen(true) }] : []),
    { key: 'price', icon: Calculator, label: t('pricing:prospects.calculatePrice'), onClick: () => navigate(`/clients?tab=calculator&prospectId=${sheet.id}`) },
    sheet.archivedAt
      ? { key: 'unarchive', icon: ArchiveRestore, label: t('pricing:prospects.unarchive'), onClick: () => void write(() => api.post(`/api/prospects/${sheet.id}/unarchive`)) }
      : { key: 'archive', icon: Archive, label: t('common:actions.archive'), onClick: () => void write(() => api.post(`/api/prospects/${sheet.id}/archive`)) },
  ]

  const loadedRows = timeline.data?.pages.flatMap((page) => page.entries) ?? []
  const countOf = (kind: 'email' | 'call') => {
    const count = loadedRows.filter((row) => row.kind === kind).length
    return timeline.hasNextPage ? `${count}+` : String(count)
  }
  const tabs: Array<{ key: TabKey; label: string; count?: string; show: boolean }> = [
    { key: 'activity', label: t('clients:sheet.tabs.activity'), show: true },
    { key: 'notes', label: t('clients:sheet.tabs.notes'), count: String((notes.data?.length ?? 0) + (voices.data?.length ?? 0)), show: true },
    { key: 'tasks', label: t('clients:sheet.tabs.tasks'), count: String(tasks.data?.filter(isOpenTask).length ?? 0), show: true },
    { key: 'emails', label: t('clients:sheet.tabs.emails'), count: countOf('email'), show: true },
    { key: 'calls', label: t('clients:sheet.tabs.calls'), count: countOf('call'), show: true },
    { key: 'discussed', label: t('clients:sheet.tabs.discussed'), show: can('mesaje.view') },
  ]

  return (
    <div data-density="comfortable" className="sheet-root">
      <div className="space-y-4">
        <SheetHeader
          sheet={sheet}
          canClaim={canClaim}
          canCall={Boolean(phone)}
          canWrite={Boolean(email)}
          onCall={() => phone && contact('call', phone.value)}
          onWrite={() => email && contact('write', email.value)}
          onSchedule={() => setScheduleOpen(true)}
          onClaim={() => void team.claim()}
          onCollaborators={() => setCollaboratorsOpen(true)}
          menu={<RowActions actions={[]} menu={menu} title={sheet.name} />}
        />
        <TeamBanner sheet={sheet} meId={meId} canClaim={canClaim} canReassign={canReassign} onRequest={() => setRequestKind('transfer')} />
        <StageBar sheet={sheet} statuses={statuses} />
        <Signals signals={sheet.signals} />

        <div className="sheet-split">
          <div className="sheet-main min-w-0 space-y-4">
            <NextStep sheet={sheet} onSchedule={() => setScheduleOpen(true)} />
            <Tabs value={tab} onValueChange={(next) => setTab(next as TabKey)}>
              <TabsList>
                {tabs
                  .filter((entry) => entry.show)
                  .map((entry) => (
                    <TabsTrigger key={entry.key} value={entry.key}>
                      {entry.label}
                      {entry.count !== undefined ? <span className="ml-1.5 tabular-nums text-muted-foreground">{entry.count}</span> : null}
                    </TabsTrigger>
                  ))}
              </TabsList>
              <TabsContent value="activity" className="pt-4">
                <ActivityTab prospectId={sheet.id} kinds={null} />
              </TabsContent>
              <TabsContent value="notes" className="pt-4">
                <NotesTab prospectId={sheet.id} />
              </TabsContent>
              <TabsContent value="tasks" className="pt-4">
                <TasksTab prospectId={sheet.id} prospectName={sheet.name} canEdit={sheet.canEdit} onSchedule={() => setScheduleOpen(true)} />
              </TabsContent>
              <TabsContent value="emails" className="pt-4">
                <ActivityTab prospectId={sheet.id} kinds={['email', 'sequence']} />
              </TabsContent>
              <TabsContent value="calls" className="pt-4">
                <ActivityTab prospectId={sheet.id} kinds={['call']} />
              </TabsContent>
              <TabsContent value="discussed" className="pt-4">
                <DiscussedTab prospectId={sheet.id} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="sheet-aside min-w-0 space-y-6">
            <Offer sheet={sheet} />
            <Properties sheet={sheet} />
            <PeopleSection sheet={sheet} onContact={contact} />
          </div>
        </div>
      </div>

      <ScheduleDialog sheet={sheet} open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <TransferDialog sheet={sheet} open={transferOpen} onOpenChange={setTransferOpen} />
      <RequestDialog sheet={sheet} kind={requestKind ?? 'transfer'} open={requestKind !== null} onOpenChange={(open) => !open && setRequestKind(null)} />
      <CollaboratorsDialog sheet={sheet} open={collaboratorsOpen} onOpenChange={setCollaboratorsOpen} canManage={manages} />
      <DiscussDialog sheet={sheet} open={discussOpen} onOpenChange={setDiscussOpen} />
      <ContactCheckDialog
        sheet={sheet}
        open={gated !== null}
        canRequest={canClaim && !mineRequested}
        onOpenChange={(open) => !open && setGated(null)}
        onContinue={() => {
          gated?.run()
          setGated(null)
        }}
        onRequestTransfer={() => {
          setGated(null)
          setRequestKind('transfer')
        }}
      />
      <AddToSequenceDialog prospects={sequenceTargets} onOpenChange={(open) => !open && setSequenceTargets([])} />
      <PromoteProspectDialog prospect={promoteOpen ? { id: sheet.id, name: sheet.name, cif: sheet.cif } : null} onOpenChange={(open) => !open && setPromoteOpen(false)} />
      <AddToListDialog open={listOpen} onOpenChange={setListOpen} prospectIds={[sheet.id]} />
      {shareDialog}
    </div>
  )
}
