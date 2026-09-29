import { describe, expect, it } from 'vitest';
import { renumberOrderedList } from '../../src/domain/formatting';

function apply(doc: string, touched: number[]) {
  const changes = renumberOrderedList(doc, touched);
  return [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to),
      doc,
    );
}

describe('renumberOrderedList', () => {
  it('shifts following numbers after a middle item is deleted', () => {
    expect(apply('1. a\n3. c', [1])).toBe('1. a\n2. c');
  });
  it('restarts at one when the first item is deleted', () => {
    expect(apply('2. b\n3. c', [0])).toBe('1. b\n2. c');
  });
  it('renumbers a nested level without touching the parent level', () => {
    expect(apply('1. a\n   1. x\n   3. y\n2. b', [2])).toBe('1. a\n   1. x\n   2. y\n2. b');
  });
  it('keeps a wrapped continuation line and the parent numbering', () => {
    expect(apply('1. a\n   continued\n2. b', [1])).toBe('1. a\n   continued\n2. b');
  });
  it('preserves the ordered-marker delimiter style', () => {
    expect(apply('1) a\n3) b', [1])).toBe('1) a\n2) b');
  });
  it('ignores a touched line with no ordered list nearby', () => {
    expect(apply('plain text\nmore text', [0])).toBe('plain text\nmore text');
  });
  it('produces minimal marker-only changes', () => {
    expect(renumberOrderedList('1. a\n3. c', [1])).toEqual([{ from: 5, to: 7, insert: '2.' }]);
  });
});
