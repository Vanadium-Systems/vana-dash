import { z } from 'zod/v4'
import * as alertsService from '../../alerts/service.js'
import { autoTool } from './shared.js'

export function buildAlertsTools() {
  return [
    autoTool({
      name: 'list_alert_rules',
      inputSchema: z.object({}),
      description: 'Listă reguli de alertă configurate.',
      run: () => alertsService.listAlertRules(),
    }),
    autoTool({
      name: 'list_alerts',
      inputSchema: z.object({ status: z.enum(['active', 'acknowledged', 'all']).optional() }),
      description: 'Listă alerte declanșate, filtrabile după status.',
      run: (a) => alertsService.listAlerts(a as never),
    }),
    autoTool({
      name: 'count_active_alerts',
      inputSchema: z.object({}),
      description: 'Numărul de alerte active nerezolvate.',
      run: () => alertsService.countActiveAlerts(),
    }),
    autoTool({
      name: 'create_alert_rule',
      inputSchema: z.object({
        name: z.string().min(1),
        metricKey: z.string().min(1),
        condition: z.enum(['lt', 'lte', 'gt', 'gte']),
        threshold: z.number(),
        windowHours: z.number().int().positive().optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        platformId: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
      description: 'Creează o regulă de alertă nouă (ex. revenue < prag). Reversibil.',
      run: (a) => alertsService.createAlertRule(a as never),
    }),
    autoTool({
      name: 'update_alert_rule',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        condition: z.enum(['lt', 'lte', 'gt', 'gte']).optional(),
        threshold: z.number().optional(),
        windowHours: z.number().int().positive().optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        enabled: z.boolean().optional(),
      }),
      description: 'Editează o regulă de alertă existentă.',
      run: ({ id, ...rest }) => alertsService.updateAlertRule(id, rest as never),
    }),
    autoTool({
      name: 'delete_alert_rule',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge o regulă de alertă. Reversibil (se poate recrea).',
      run: (a) => alertsService.deleteAlertRule(a.id),
    }),
    autoTool({
      name: 'ack_alert',
      inputSchema: z.object({ id: z.string() }),
      description: 'Marchează o alertă activă ca văzută/rezolvată.',
      run: (a) => alertsService.ackAlert(a.id),
    }),
    autoTool({
      name: 'snooze_alert',
      inputSchema: z.object({ id: z.string(), days: z.number().int().positive().max(90) }),
      description: 'Amână o alertă pentru un număr de zile.',
      run: ({ id, days }) => alertsService.snoozeAlert(id, { days }),
    }),
  ]
}
