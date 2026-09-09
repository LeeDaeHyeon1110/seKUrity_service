const MAX_DISCORD_MESSAGE_LENGTH = 1900;

export function parseLines(value: string, maxItems: number): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function parseHttpLinks(value: string, maxItems: number): {
  links: string[];
  invalidValues: string[];
  exceededLimit: boolean;
} {
  const values = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const links: string[] = [];
  const invalidValues: string[] = [];

  for (const valueItem of values.slice(0, maxItems)) {
    try {
      const parsed = new URL(valueItem);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        invalidValues.push(valueItem);
        continue;
      }

      links.push(parsed.toString());
    } catch {
      invalidValues.push(valueItem);
    }
  }

  return {
    links: [...new Set(links)],
    invalidValues,
    exceededLimit: values.length > maxItems,
  };
}

export function hasEvidenceOrComment(input: {
  attachmentCount: number;
  linkCount: number;
  comment: string;
}): boolean {
  return input.attachmentCount > 0
    || input.linkCount > 0
    || input.comment.trim().length > 0;
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function splitMessage(value: string): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of value.split('\n')) {
    if (line.length > MAX_DISCORD_MESSAGE_LENGTH) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      for (let index = 0; index < line.length; index += MAX_DISCORD_MESSAGE_LENGTH) {
        chunks.push(line.slice(index, index + MAX_DISCORD_MESSAGE_LENGTH));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length > MAX_DISCORD_MESSAGE_LENGTH) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : ['내용 없음'];
}

export function formatList(items: string[]): string {
  if (items.length === 0) {
    return '- 없음';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

export function formatThreadName(projectName: string): string {
  return truncateText(projectName.trim().replace(/\s+/g, ' '), 100);
}

export function formatScrumThreadName(
  requesterName: string,
  projectName: string,
): string {
  return formatThreadName(`[${requesterName}] ${projectName}`);
}

export function replaceScrumThreadStatus(
  threadName: string,
  status: 'completed' | 'abandoned',
): string {
  const statusLabel = status === 'completed' ? '완료' : '포기';
  const nameWithoutStatus = threadName.replace(
    /^\[(?:완료|포기)\]\s*/,
    '',
  );

  return formatThreadName(`[${statusLabel}] ${nameWithoutStatus}`);
}

export function replaceScrumThreadTitle(
  threadName: string,
  projectName: string,
): string {
  const prefix = threadName.match(
    /^(?:\[(?:완료|포기)\]\s*)?\[[^\]]+\]\s*/,
  )?.[0] ?? '';

  return formatThreadName(`${prefix}${projectName}`);
}

export function formatApprovalThreadName(
  requesterName: string,
  projectName: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending',
): string {
  const statusLabel = status === 'approved'
    ? '승인'
    : status === 'rejected'
      ? '반려'
      : '승인 대기';

  return formatThreadName(
    `[${statusLabel}] [${requesterName}] ${projectName}`,
  );
}

export function replaceApprovalThreadStatus(
  threadName: string,
  status: 'approved' | 'rejected',
): string {
  const statusLabel = status === 'approved' ? '승인' : '반려';
  const nameWithoutStatus = threadName.replace(
    /^\[(?:승인 대기|승인|반려)\]\s*/,
    '',
  );

  return formatThreadName(`[${statusLabel}] ${nameWithoutStatus}`);
}
