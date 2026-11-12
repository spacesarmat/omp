export function branchMayAutoMerge(branch: string): boolean;
export function checksVerdict(checks: { name?: string; state?: string }[]): 'pass' | 'fail' | 'wait';
