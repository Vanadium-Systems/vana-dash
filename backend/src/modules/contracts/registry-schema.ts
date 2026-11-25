import { z } from 'zod'
import { CONTRACT_COUNTERPARTY_KINDS, CONTRACT_STATUSES } from '../../shared/db/schema/contracts.js'

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const commaList = <T extends [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))

export const RegistryQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: commaList([...CONTRACT_STATUSES]).optional(),
  category: z.string().trim().max(60).optional(),
  kind: z.enum(CONTRACT_COUNTERPARTY_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50].includes(n)).default(25),
})

export const CounterpartySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('client'), id: z.string().uuid() }),
  z.object({ kind: z.literal('prospect'), id: z.string().uuid() }),
  z.object({ kind: z.literal('user'), id: z.string().uuid() }),
  z.object({ kind: z.literal('other'), name: z.string().trim().min(1).max(200) }),
])

// The terms shared by "from template" and "upload".
const TermsSchema = z.object({
  startsOn: IsoDate.nullish(),
  endsOn: IsoDate.nullish(),
  autoRenew: z.boolean().default(false),
  renewalMonths: z.number().int().min(1).max(120).nullish(),
  noticeDays: z.number().int().min(1).max(730).nullish(),
  ownerUserId: z.string().uuid().optional(),
})

const termsRules = <T extends z.infer<typeof TermsSchema>>(v: T, ctx: z.RefinementCtx) => {
  if (v.autoRenew && !v.renewalMonths) ctx.addIssue({ code: 'custom', path: ['renewalMonths'], message: 'required with autoRenew' })
  if (v.noticeDays && !v.endsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'required with noticeDays' })
  if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'before startsOn' })
}

const PartyDetailsSchema = z
  .object({
    cui: z.string().trim().max(40),
    nrRegCom: z.string().trim().max(60),
    adresa: z.string().trim().max(300),
    reprezentant: z.string().trim().max(120),
    functie: z.string().trim().max(120),
    email: z.string().trim().max(200),
  })
  .partial()

export const PartyQuerySchema = z.object({ kind: z.enum(['client', 'prospect', 'user']), id: z.string().uuid() })

export const CreateContractSchema = TermsSchema.extend({
  templateId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  fieldValues: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
  counterparty: CounterpartySchema,
  // What the form shows (and the person may have corrected) wins over what the client's record holds.
  partyDetails: PartyDetailsSchema.default({}),
  seriesId: z.string().uuid().optional(),
  number: z.number().int().min(1).optional(),
}).superRefine(termsRules)

export const UploadContractMetaSchema = TermsSchema.extend({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60),
  counterparty: CounterpartySchema,
  signedOn: IsoDate.nullish(),
  // A contract still waiting for the other side's signature can be filed too.
  status: z.enum(['to_sign', 'signed']).default('signed'),
  // Either one of our numbers or the other company's own (text).
  seriesId: z.string().uuid().optional(),
  number: z.number().int().min(1).optional(),
  externalNumber: z.string().trim().min(1).max(60).optional(),
}).superRefine((v, ctx) => {
  termsRules(v, ctx)
  if (v.number && v.externalNumber) ctx.addIssue({ code: 'custom', path: ['externalNumber'], message: 'number or externalNumber' })
})

export const UpdateContractSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(60),
    status: z.enum(CONTRACT_STATUSES),
    signedOn: IsoDate.nullable(),
    startsOn: IsoDate.nullable(),
    endsOn: IsoDate.nullable(),
    autoRenew: z.boolean(),
    renewalMonths: z.number().int().min(1).max(120).nullable(),
    noticeDays: z.number().int().min(1).max(730).nullable(),
    ownerUserId: z.string().uuid(),
    externalNumber: z.string().trim().min(1).max(60).nullable(),
  })
  .partial()

export const NumbersQuerySchema = z.object({ seriesId: z.string().uuid().optional() })

export const ReserveNumberSchema = z.object({
  seriesId: z.string().uuid(),
  number: z.number().int().min(1),
  note: z.string().trim().min(1).max(120),
})

export const SeriesSchema = z.object({
  code: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(80),
  numberFormat: z.string().trim().min(1).max(40).refine((f) => f.includes('{n'), 'needs {n}'),
})

const FIELD_TYPES = ['text', 'number', 'date', 'money', 'list', 'party'] as const
export const TemplateFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: z.object({ ro: z.string().trim().min(1).max(80), en: z.string().trim().min(1).max(80) }),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  default: z.string().max(500).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
})
export type TemplateField = z.infer<typeof TemplateFieldSchema>

export const SignerRoleSchema = z.object({
  role: z.string().trim().min(1).max(40).regex(/^[\p{L}0-9 _-]+$/u),
  own: z.boolean(),
})
export type SignerRole = z.infer<typeof SignerRoleSchema>

export const CustomTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  bodyHtml: z.string().min(1).max(400_000),
  fields: z.array(TemplateFieldSchema).max(60).default([]),
  seriesId: z.string().uuid().nullable().default(null),
  signerRoles: z.array(SignerRoleSchema).max(6).default([]),
})

export const IdParamsSchema = z.object({ id: z.string().uuid() })
