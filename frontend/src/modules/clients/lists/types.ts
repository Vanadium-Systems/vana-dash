export interface ListFolder {
  id: string
  name: string
  shared: boolean
  ownerId: string
  ownerName: string
  isMine: boolean
}

export interface ListEntry {
  id: string
  name: string
  folderId: string | null
  shared: boolean
  ownerId: string
  ownerName: string
  isMine: boolean
  memberCount: number
}

export interface SkipRules {
  skipInFolderLists?: boolean
  skipWithoutPhone?: boolean
  skipDoNotContact?: boolean
}

export interface AddMembersResult {
  added: number
  skipped: { alreadyIn: number; inFolderLists: number; withoutPhone: number; doNotContact: number; notVisible: number }
}
