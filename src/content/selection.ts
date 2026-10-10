// Remembers the user's selection so it can be hidden while reading and put back
// afterwards (on pause, stop or when the reading finishes).

export class SelectionKeeper {
  private saved: Range[] = [];
  private hidden = false;

  /** Returns the current non-empty selection (as one range) and remembers it. */
  capture(): Range | null {
    this.saved = currentRanges();
    this.hidden = false;
    return merge(this.saved);
  }

  hide(): void {
    if (!this.saved.length) return;
    getSelection()?.removeAllRanges();
    this.hidden = true;
  }

  restore(): void {
    if (!this.hidden) return;
    this.hidden = false;
    const sel = getSelection();
    // Don't clobber a selection the user made in the meantime.
    if (!sel || (sel.rangeCount && !sel.isCollapsed)) return;
    sel.removeAllRanges();
    for (const r of this.saved) sel.addRange(r);
  }

  /** True if the user selected something other than what is being read. */
  hasNewSelection(): boolean {
    const now = currentRanges();
    if (!now.length) return false;
    if (now.length !== this.saved.length) return true;
    return now.some(
      (r, i) =>
        r.compareBoundaryPoints(Range.START_TO_START, this.saved[i]) !== 0 ||
        r.compareBoundaryPoints(Range.END_TO_END, this.saved[i]) !== 0,
    );
  }
}

/** The current non-empty selection as one range, without remembering it. */
export function selectionRange(): Range | null {
  return merge(currentRanges());
}

function merge(ranges: Range[]): Range | null {
  if (!ranges.length) return null;
  const r = document.createRange();
  r.setStart(ranges[0].startContainer, ranges[0].startOffset);
  const last = ranges[ranges.length - 1];
  r.setEnd(last.endContainer, last.endOffset);
  return r;
}

function currentRanges(): Range[] {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return [];
  const ranges: Range[] = [];
  for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
  return ranges;
}
