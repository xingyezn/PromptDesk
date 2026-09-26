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
export function formatSelection(kind: FormatKind, selected: string): string {
  const lines = (selected || '内容').split('\n');
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
