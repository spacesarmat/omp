export function branchMayAutoMerge(branch: string): boolean;
export function checksVerdict(checks: { name?: string; state?: string }[]): 'pass' | 'fail' | 'wait';
export function runsVerdict(runs: { name?: string; conclusion?: string; status?: string }[], expected: string[]): 'pass' | 'fail' | 'wait';
