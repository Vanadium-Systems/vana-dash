export interface TenantRow {
  id: string
  name: string
  slug: string
  cif: string | null
  isPlatformOwner: boolean
  status: 'active' | 'suspended'
  features: string[]
  userCount: number
  createdAt: string
}
