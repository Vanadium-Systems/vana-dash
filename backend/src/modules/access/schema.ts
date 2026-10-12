import { z } from 'zod'

export const CreateRoleSchema = z.object({
  name: z.string().min(2).max(60),
  copyFromRoleId: z.string().uuid().optional(),
})

export const RenameRoleSchema = z.object({ name: z.string().min(2).max(60) })

export const RoleFeatureSchema = z.object({ enabled: z.boolean() })

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80).optional(),
  roleId: z.string().uuid(),
})

export const UpdateMemberSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export const MemberMailboxesSchema = z.object({
  identityKeys: z.array(z.string().min(1).max(60)).max(50),
})
