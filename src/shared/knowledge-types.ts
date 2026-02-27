export type KnowledgeCategory = 'business_rule' | 'architecture' | 'api_quirk' | 'lesson_learned' | 'convention'
export type KnowledgeSource = 'workshop' | 'pipeline' | 'manual' | 'fdrl'
export type KnowledgeStatus = 'candidate' | 'active' | 'archived'

export interface KnowledgeEntry {
  id: string
  key: string
  summary: string
  content: string
  category: KnowledgeCategory
  tags: string[]
  source: KnowledgeSource
  sourceId: string | null
  status: KnowledgeStatus
  tokenEstimate: number
  createdAt: string
  updatedAt: string
}
