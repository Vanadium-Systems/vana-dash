import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { BillingClient, ContractAddendum, ContractDocument } from '@/shared/lib/types'
import { AddendumFormDialog } from './AddendumFormDialog'
import { ContractTemplatesCard } from './ContractTemplatesCard'
import { ReservedNumbersCard } from './ReservedNumbersCard'
import { SignDocumentDialog } from './SignDocumentDialog'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

const DOC_TYPE_LABEL: Record<ContractDocument['docType'], string> = {
  contract: t('accounting:docTypes.contract'),
  anexa: t('accounting:docTypes.priceAnnex'),
  act_aditional: t('accounting:docTypes.addendum'),
}

// Oglinda client-side a `assertContractDataComplete` din backend — doar informativ (backend
// rămâne sursa de adevăr, verificarea reală se face la generare); aici doar avertizăm din timp
// ce lipsește, ca Stefan să nu afle abia după click pe „Generează".
function missingFields(client: BillingClient): string[] {
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

export function ContractsTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [addendumDialogOpen, setAddendumDialogOpen] = useState(false)
  const [signingDoc, setSigningDoc] = useState<ContractDocument | null>(null)

  const clients = useQuery({
    queryKey: ['billing-clients'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'),
  })

  const filteredClients = (clients.data ?? [])
    .filter((c) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.cif.toLowerCase().includes(q)
    })
    .slice(0, 8)

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
      toast.success(`${DOC_TYPE_LABEL[doc.docType]} generat`)
      window.open(`/api/contracts/documents/${doc.id}/pdf`, '_blank')
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleSigned = useMutation({
    mutationFn: ({ id, isSigned }: { id: string; isSigned: boolean }) =>
      api.patch<ContractDocument>(`/api/contracts/documents/${id}`, { isSigned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['contract-documents', clientId] }),
    onError: (err) => toast.error(err.message),
  })

  const generateAddendumDoc = useMutation({
    mutationFn: (addendumId: string) => api.post<ContractDocument>(`/api/contracts/addenda/${addendumId}/document`, {}),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents', clientId] })
      toast.success(t('accounting:contracts.addendumPdfGenerated'))
      window.open(`/api/contracts/documents/${doc.id}/pdf`, '_blank')
    },
    onError: (err) => toast.error(err.message),
  })

  const missing = selectedClient ? missingFields(selectedClient) : []
  const latestSignedByType = (docType: ContractDocument['docType']) =>
    documents.data?.filter((d) => d.docType === docType).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('accounting:contracts.selectClient')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('accounting:clientForm.searchByNameOrCif')}
          />
          {clients.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {filteredClients.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  variant={c.id === clientId ? 'default' : 'outline'}
                  onClick={() => setClientId(c.id)}
                >
                  {c.name}
                </Button>
              ))}
              {filteredClients.length === 0 && <p className="text-sm text-muted-foreground">{t('accounting:contracts.noClientFound')}</p>}
            </div>
          )}
        </CardContent>
      </Card>

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
                  onClick={() => window.open(`/api/contracts/clients/${clientId}/preview?docType=contract`, '_blank')}
                >
                  {t('accounting:contracts.simulateContract')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => window.open(`/api/contracts/clients/${clientId}/preview?docType=anexa`, '_blank')}
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
                <Skeleton className="h-24 w-full" />
              ) : !documents.data?.length ? (
                <p className="text-sm text-muted-foreground">{t('accounting:contracts.noDocuments')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common:labels.type')}</TableHead>
                      <TableHead>{t('accounting:contracts.generated')}</TableHead>
                      <TableHead>{t('common:labels.status')}</TableHead>
                      <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.data.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{DOC_TYPE_LABEL[d.docType]}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
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
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => window.open(`/api/contracts/documents/${d.id}/pdf`, '_blank')}>
                              PDF
                            </Button>
                            {!d.isSigned ? (
                              <Button variant="outline" onClick={() => setSigningDoc(d)}>
                                {t('accounting:contracts.sign')}
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() => toggleSigned.mutate({ id: d.id, isSigned: !d.isSigned })}
                            >
                              {d.isSigned ? t('accounting:contracts.markUnsigned') : t('accounting:contracts.markSigned')}
                            </Button>
                          </div>
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
                <Skeleton className="h-24 w-full" />
              ) : !addenda.data?.length ? (
                <p className="text-sm text-muted-foreground">{t('accounting:contracts.noAddenda')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common:labels.number')}</TableHead>
                      <TableHead>{t('common:labels.date')}</TableHead>
                      <TableHead>{t('accounting:addendum.newRate')}</TableHead>
                      <TableHead>{t('common:labels.reason')}</TableHead>
                      <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addenda.data.map((a) => {
                      const doc = documents.data?.find((d) => d.addendumId === a.id)
                      return (
                        <TableRow key={a.id}>
                          <TableCell>{a.number}</TableCell>
                          <TableCell>{a.issuedAt}</TableCell>
                          <TableCell>{a.newPriceNote}</TableCell>
                          <TableCell className="max-w-xs truncate">{a.reason}</TableCell>
                          <TableCell className="text-right">
                            {doc ? (
                              <Button variant="outline" onClick={() => window.open(`/api/contracts/documents/${doc.id}/pdf`, '_blank')}>
                                PDF
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                disabled={generateAddendumDoc.isPending}
                                onClick={() => generateAddendumDoc.mutate(a.id)}
                              >
                                {t('accounting:contracts.generatePdf')}
                              </Button>
                            )}
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
      <ReservedNumbersCard />
      <ContractTemplatesCard />
    </div>
  )
}
