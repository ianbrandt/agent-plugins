export type Severity = 'high' | 'medium' | 'low'
export type ReviewSide = 'claude' | 'codex'
export type Verdict = 'APPROVED' | 'REVISE' | 'BLOCKED'
export type RulingKind = 'agree' | 'dispute' | 'withdraw'

// A finding as a reviewer reports it. `id` is the reviewer's own until the mod prefixes it.
export type ReportedFinding = {
  id: string
  severity: Severity
  path: string
  line?: number
  evidence: string
  fix: string
  // In a fix phase: the id of the earlier finding that the reviewer reports as still present.
  of?: string
  // In a fix phase: a defect older than the fix, reported without keeping the loop going.
  preexisting?: boolean
}

// `same`: on an agree, the id of the other reviewer's finding that is the same defect.
export type Ruling = { id: string; ruling: RulingKind; severity?: Severity; same?: string; evidence: string }

export type Reply = {
  verdict?: Verdict
  summary?: string
  findings: ReportedFinding[]
  rulings: Ruling[]
  coverage: string[]
  limitations: string[]
}

export type Status =
  | 'open'
  | 'disputed'
  | 'needs-probe'
  | 'agreed'
  | 'withdrawn'
  | 'preexisting'
  | 'confirmed'
  | 'refuted'
  | 'inconclusive'

export type Finding = ReportedFinding & {
  // Prefixed by the mod: C1, C2, ... for Claude, X1, X2, ... for Codex, unique across the run.
  side: ReviewSide
  phase: number
  raisedInRound: number
  status: Status
  disputes: number
  rulings: (Ruling & { side: ReviewSide; round: number })[]
  settled?: { outcome: 'confirmed' | 'refuted' | 'inconclusive'; evidence: string }
}

export type FixOutcome = 'fixed' | 'still-present' | 'unresolved'
