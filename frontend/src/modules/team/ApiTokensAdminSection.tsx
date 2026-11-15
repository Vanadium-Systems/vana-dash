import { Ban } from 'lucide-react'
import { useState } from 'react'
import { expiresText, lastUsedText, prefixText, useAdminApiTokens, useRevokeApiToken, type AdminApiTokenItem } from '@/modules/auth/api-tokens'
import { Button } from '@/shared/components/ui/button'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { t } from '@/shared/lib/i18n'

// The company's active tokens, for `echipa.administrare`: the admin revokes them when someone leaves.

export function ApiTokensAdminSection() {
  const tokens = useAdminApiTokens()
  const revoke = useRevokeApiToken(true)
  const [revoking, setRevoking] = useState<AdminApiTokenItem | null>(null)

  return (
    <section className="space-y-3" aria-labelledby="api-tokens-admin-title">
      <div>
        <h2 id="api-tokens-admin-title" className="text-base font-medium">
          {t('auth:apiTokens.admin.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('auth:apiTokens.admin.description')}</p>
      </div>

      {tokens.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : tokens.isError ? (
        <div className="space-y-2 text-sm">
          <p>{t('auth:apiTokens.loadFailed')}</p>
          <Button variant="outline" onClick={() => void tokens.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : tokens.data.length === 0 ? (
        <EmptyState kind="new" title={t('auth:apiTokens.admin.empty')} />
      ) : (
        <Table>
          <caption className="sr-only">{t('auth:apiTokens.admin.tableCaption')}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('auth:apiTokens.columns.person')}</TableHead>
              <TableHead priority="md">{t('common:labels.name')}</TableHead>
              <TableHead priority="lg">{t('auth:apiTokens.columns.prefix')}</TableHead>
              <TableHead priority="md">{t('auth:apiTokens.columns.lastUsed')}</TableHead>
              <TableHead priority="lg">{t('auth:apiTokens.columns.expires')}</TableHead>
              <TableHead className="text-right">
                <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.data.map((token) => (
              <TableRow key={token.id}>
                <TableCell className="font-medium tbl-fill">
                  <div className="truncate">{token.user.displayName ?? token.user.email}</div>
                  <TableDetails
                    items={[token.name, <span key="prefix" className="font-mono">{prefixText(token)}</span>, lastUsedText(token, true), expiresText(token)]}
                  />
                </TableCell>
                <TableCell priority="md" className="max-w-[10rem] truncate">
                  {token.name}
                </TableCell>
                <TableCell priority="lg" className="whitespace-nowrap font-mono text-xs">
                  {prefixText(token)}
                </TableCell>
                <TableCell priority="md" className="whitespace-nowrap">
                  {lastUsedText(token)}
                </TableCell>
                <TableCell priority="lg" className="whitespace-nowrap">
                  {expiresText(token)}
                </TableCell>
                <TableCell className="text-right">
                  <RowActions
                    title={token.name}
                    actions={[{ key: 'revoke', icon: Ban, label: t('auth:apiTokens.revoke'), destructive: true, onClick: () => setRevoking(token) }]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('auth:apiTokens.revokeDialog.title', { name: revoking?.name ?? '' })}
        consequence={t('auth:apiTokens.revokeDialog.body')}
        confirmLabel={t('auth:apiTokens.revokeDialog.confirm')}
        destructive
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </section>
  )
}
