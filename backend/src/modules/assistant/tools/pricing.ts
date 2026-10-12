import { z } from 'zod/v4'
import * as pricingService from '../../pricing/service.js'
import { autoTool } from './shared.js'

export function buildPricingTools() {
  return [
    autoTool({
      name: 'get_pricing_config',
      inputSchema: z.object({ platformId: z.string() }),
      description: 'Configurația calculatorului de preț pentru o platformă (benzi, rate, addon-uri).',
      run: (a) => pricingService.getConfig(a.platformId),
    }),
  ]
}
