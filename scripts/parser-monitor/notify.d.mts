export function notifyText(
  report: { at?: string; reports?: { id: string; name?: string; status: string; detail?: string }[] } | null,
  opts?: { runUrl?: string; dryRun?: boolean },
): string;
