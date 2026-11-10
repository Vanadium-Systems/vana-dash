import { Check, Download, FilePlus, PenLine, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { BillingClient, ContractAddendum, ContractDocument } from '@/shared/lib/types'
import { AddendumFormDialog } from './AddendumFormDialog'
import { SignDocumentDialog } from './SignDocumentDialog'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { openFile } from '@/shared/lib/open-file'

const DOC_TYPE_LABEL: Record<ContractDocument['docType'], string> = {
  contract: t('accounting:docTypes.contract'),
  anexa: t('accounting:docTypes.priceAnnex'),
  act_aditional: t('accounting:docTypes.addendum'),
}

// Client-side mirror of the backend's `assertContractDataComplete`, for warning only: the backend
// still checks at generation time; this just shows what is missing before anyone clicks Generate.
export function missingFields(client: BillingClient): string[] {
  const missing: string[] = []
  if (!client.contactName) missing.push(t('accounting:contract.fields.representative'))
  if (!client.contactTitle) missing.push(t('accounting:contract.fields.representativeRole'))
  if (!client.phone) missing.push(t('accounting:contract.fields.clientPhone'))
  if (!client.contractPlan) missing.push('Plan')
  const hasPrice =
    (client.subscriptionPriceCurrency === 'eur' && client.subscriptionPriceEur) ||
    (client.subscriptionPriceCurrency === 'lei' && client.subscriptionPriceLei)
  if (!hasPrice) missing.push(t('accounting:contract.fields.subscriptionRate'))
  const d = client.contractDetails ?? {}
  if (!d.nrContract) missing.push(t('accounting:contract.fields.contractNumber'))
  if (!d.dataContract) missing.push(t('accounting:contract.fields.contractDate'))
  if (!d.taxaInitiere) missing.push(t('accounting:contract.fields.setupFee'))
  if (!d.facturareTip) missing.push(t('accounting:contract.fields.billingCycle'))
  return missing
}

/** The client's contract documents and addenda: generate, sign, add an addendum. Shown in the peek of the contracts list. */
export function ContractDetail({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
  const [signingDoc, setSigningDoc] = useState<ContractDocument | null>(null)

  const clients = useQuery({
    queryKey: ['billing-clients'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'),
  })
  const selectedClient = clients.data?.find((c) => c.id === clientId) ?? null

  const documents = useQuery({
    queryKey: ['contract-documents', clientId],
    queryFn: () => api.get<ContractDocument[]>(`/api/contracts/clients/${clientId}/documents`),
    enabled: Boolean(clientId),
  })

  const addenda = useQuery({
    queryKey: ['contract-addenda', clientId],
    queryFn: () => api.get<ContractAddendum[]>(`/api/contracts/clients/${clientId}/addenda`),
    enabled: Boolean(clientId),
  })

  const generateDoc = useMutation({
    mutationFn: (docType: 'contract' | 'anexa') =>
      api.post<ContractDocument>(`/api/contracts/clients/${clientId}/documents`, { docType }),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents', clientId] })
      void queryClient.invalidateQueries({ queryKey: ['contracts', 'list'] })
      toast.success(t('accounting:contracts.documentGenerated', { type: DOC_TYPE_LABEL[doc.docType] }))
      openFile(`/api/contracts/documents/${doc.id}/pdf`, 'document.pdf')
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleSigned = useMutation({
    mutationFn: ({ id, isSigned }: { id: string; isSigned: boolean }) =>
      api.patch<ContractDocument>(`/api/contracts/documents/${id}`, { isSigned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents', clientId] })
      void queryClient.invalidateQueries({ queryKey: ['contracts', 'list'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const generateAddendumDoc = useMutation({
    mutationFn: (addendumId: string) => api.post<ContractDocument>(`/api/contracts/addenda/${addendumId}/document`, {}),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents', clientId] })
      void queryClient.invalidateQueries({ queryKey: ['contracts', 'list'] })
      toast.success(t('accounting:contracts.addendumPdfGenerated'))
      openFile(`/api/contracts/documents/${doc.id}/pdf`, 'document.pdf')
    },
    onError: (err) => toast.error(err.message),
  })

  const missing = selectedClient ? missingFields(selectedClient) : []
  const latestSignedByType = (docType: ContractDocument['docType']) =>
    documents.data?.filter((d) => d.docType === docType).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  return (
    <div className="space-y-4" data-density="comfortable">
      {clients.isPending ? <ListSkeleton rows={4} /> : null}
      {selectedClient && (
        <>
          {missing.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning dark:bg-transparent">
              {t('accounting:contracts.missingData', { missing: missing.join(', ') })}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('accounting:contracts.documentsFor', { name: selectedClient.name })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={missing.length > 0 || generateDoc.isPending}
                  onClick={() => generateDoc.mutate('contract')}
                >
                  {t('accounting:contracts.generateContract')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={missing.length > 0 || generateDoc.isPending}
                  onClick={() => generateDoc.mutate('anexa')}
                >
                  {t('accounting:contracts.generateAnnex')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => openFile(`/api/contracts/clients/${clientId}/preview?docType=contract`, 'document.pdf')}
                >
                  {t('accounting:contracts.simulateContract')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => openFile(`/api/contracts/clients/${clientId}/preview?docType=anexa`, 'document.pdf')}
                >
                  {t('accounting:contracts.simulateAnnex')}
                </Button>
              </div>
              {(['contract', 'anexa'] as const).map((docType) => {
                const latest = latestSignedByType(docType)
                return latest?.isSigned ? (
                  <p key={docType} className="text-xs text-warning">
                    {t('accounting:contracts.alreadySigned', { value: DOC_TYPE_LABEL[docType].toLowerCase() })}
                  </p>
                ) : null
              })}

              {documents.isPending ? (
                <ListSkeleton rows={3} />
              ) : !documents.data?.length ? (
                <p className="text-sm text-muted-foreground">{t('accounting:contracts.noDocuments')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common:labels.type')}</TableHead>
                      <TableHead priority="md">{t('accounting:contracts.generated')}</TableHead>
                      <TableHead>{t('common:labels.status')}</TableHead>
                      <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.data.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="tbl-fill">
                          <div className="truncate">{DOC_TYPE_LABEL[d.docType]}</div>
                          <TableDetails items={[new Date(d.createdAt).toLocaleString(intlTag())]} />
                        </TableCell>
                        <TableCell priority="md" className="text-xs text-muted-foreground">
                          {new Date(d.createdAt).toLocaleString(intlTag())}
                        </TableCell>
                        <TableCell>
                          {d.isSigned ? (
                            <StatePill tone="success">{t('accounting:contracts.signed')}</StatePill>
                          ) : (
                            <StatePill tone="neutral">{t('accounting:contracts.unsigned')}</StatePill>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActions
                            actions={[
                              { key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/contracts/documents/${d.id}/pdf`, 'document.pdf') },
                              ...(!d.isSigned ? [{ key: 'sign', icon: PenLine, label: t('accounting:contracts.sign'), onClick: () => setSigningDoc(d) }] : []),
                              {
                                key: 'signed',
                                icon: d.isSigned ? X : Check,
                                label: d.isSigned ? t('accounting:contracts.markUnsigned') : t('accounting:contracts.markSigned'),
                                onClick: () => toggleSigned.mutate({ id: d.id, isSigned: !d.isSigned }),
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{t('accounting:contracts.addendaTitle')}</CardTitle>
              <Button type="button" onClick={() => setAddendumDialogOpen(true)}>
                {t('accounting:addendum.add')}
              </Button>
            </CardHeader>
            <CardContent>
              {addenda.isPending ? (
                <ListSkeleton rows={3} />
              ) : !addenda.data?.length ? (
                <p className="text-sm text-muted-foreground">{t('accounting:contracts.noAddenda')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common:labels.number')}</TableHead>
                      <TableHead priority="md">{t('common:labels.date')}</TableHead>
                      <TableHead>{t('accounting:addendum.newRate')}</TableHead>
                      <TableHead priority="lg">{t('common:labels.reason')}</TableHead>
                      <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addenda.data.map((a) => {
                      const doc = documents.data?.find((d) => d.addendumId === a.id)
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="tbl-fill">
                            <div className="whitespace-nowrap">{a.number}</div>
                            <TableDetails items={[a.issuedAt]} />
                          </TableCell>
                          <TableCell priority="md" className="whitespace-nowrap">{a.issuedAt}</TableCell>
                          <TableCell truncate>{a.newPriceNote}</TableCell>
                          <TableCell priority="lg" className="max-w-xs truncate">{a.reason}</TableCell>
                          <TableCell className="text-right">
                            <RowActions
                              actions={[
                                doc
                                  ? { key: 'pdf', icon: Download, label: t('common:actions.downloadPdf'), onClick: () => openFile(`/api/contracts/documents/${doc.id}/pdf`, 'document.pdf') }
                                  : { key: 'generate', icon: FilePlus, label: t('accounting:contracts.generatePdf'), disabled: generateAddendumDoc.isPending, onClick: () => generateAddendumDoc.mutate(a.id) },
                              ]}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <AddendumFormDialog open={addendumDialogOpen} onOpenChange={setAddendumDialogOpen} clientId={clientId} />
          <SignDocumentDialog doc={signingDoc} onOpenChange={(open) => !open && setSigningDoc(null)} />
        </>
      )}
    </div>
  )
}
