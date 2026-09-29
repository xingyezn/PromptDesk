export const formatLabels = {
  heading: '标题',
  bold: '粗体',
  bullet: '无序列表',
  numbered: '有序列表',
  task: '任务列表',
  quote: '引用',
  code: '代码块',
  table: '表格',
} as const;
export type FormatKind = keyof typeof formatLabels;

const orderedListLine = /^([ \t]*)(\d+)([.)])(?:\s.*)?$/;
const continuationLine = /^[ \t]+\S/;

// Renumbers each contiguous ordered-list block touched by an edit, so deleting a middle
// item shifts the following numbers. Returns minimal marker-only replacements to keep the
// cursor and undo history stable; unrelated blocks are left untouched.
export function renumberOrderedList(
  doc: string,
  touchedLines: number[],
): { from: number; to: number; insert: string }[] {
  const lines = doc.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const blocks: { start: number; end: number }[] = [];
  const claimed = new Set<number>();
  for (const raw of touchedLines) {
    const touched = Math.min(Math.max(raw, 0), lines.length - 1);
    if (claimed.has(touched)) continue;
    let start = touched;
    while (
      start > 0 &&
      (orderedListLine.test(lines[start - 1]!) || continuationLine.test(lines[start - 1]!))
    )
      start--;
    let end = touched;
    while (
      end < lines.length - 1 &&
      (orderedListLine.test(lines[end + 1]!) || continuationLine.test(lines[end + 1]!))
    )
      end++;
    for (let i = start; i <= end; i++) claimed.add(i);
    blocks.push({ start, end });
  }
  blocks.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end + 1) last.end = Math.max(last.end, block.end);
    else merged.push({ ...block });
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const { start, end } of merged) {
    const levels: { indent: string; next: number; delimiter: string }[] = [];
    for (let i = start; i <= end; i++) {
      const match = orderedListLine.exec(lines[i]!);
      if (!match) continue;
      const indent = match[1]!;
      while (levels.length && levels[levels.length - 1]!.indent.length > indent.length)
        levels.pop();
      let level = levels[levels.length - 1];
      if (!level || level.indent.length !== indent.length) {
        level = { indent, next: 1, delimiter: match[3]! };
        levels.push(level);
      }
      const digits = match[2]!,
        delimiter = match[3]!,
        replacement = `${level.next++}${level.delimiter}`;
      const markerFrom = offsets[i]! + indent.length,
        markerTo = markerFrom + digits.length + delimiter.length;
      if (
        lines[i]!.slice(indent.length, indent.length + digits.length + delimiter.length) !==
        replacement
      )
        changes.push({ from: markerFrom, to: markerTo, insert: replacement });
    }
  }
  return changes;
}
export function formatSelection(kind: FormatKind, selected: string): string {
  const lines = (kind === 'numbered' ? selected : selected || '内容').split('\n');
  switch (kind) {
    case 'heading':
      return lines.map((line) => `## ${line.replace(/^#{1,6}\s+/, '')}`).join('\n');
    case 'bold':
      return `**${selected || '粗体文字'}**`;
    case 'bullet':
      return lines.map((line) => `- ${line.replace(/^\s*(?:[-*+] |\d+\. )/, '')}`).join('\n');
    case 'numbered':
      return lines
        .map((line, i) => `${i + 1}. ${line.replace(/^\s*(?:[-*+] |\d+\. )/, '')}`)
        .join('\n');
    case 'task':
      return lines.map((line) => `- [ ] ${line}`).join('\n');
    case 'quote':
      return lines.map((line) => `> ${line}`).join('\n');
    case 'code': {
      const longest = Math.max(2, ...Array.from(selected.matchAll(/`+/g), (m) => m[0].length));
      const fence = '`'.repeat(longest + 1);
      return `${fence}\n${selected || '代码'}\n${fence}`;
    }
    case 'table': {
      const rows = selected.trim()
        ? selected
            .trim()
            .split('\n')
            .map((line) => line.split('\t'))
        : [
            ['列 1', '列 2'],
            ['内容', '内容'],
          ];
      const width = Math.max(2, ...rows.map((row) => row.length));
      const render = (row: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => (row[i] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
      return [
        render(rows[0]!),
        render(Array.from({ length: width }, () => '---')),
        ...rows.slice(1).map(render),
      ].join('\n');
    }
  }
}
