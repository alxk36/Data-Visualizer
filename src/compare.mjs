const DEFAULT_CELL_LIMIT = 2_000_000;

/** Align text by logical lines, retaining original line numbers and unchanged rows. */
export function compareLines(first, second, { maxCells = DEFAULT_CELL_LIMIT } = {}) {
  const originalLeft = String(first ?? '');
  const originalRight = String(second ?? '');
  const left = originalLeft.split(/\r\n|\n|\r/);
  const right = originalRight.split(/\r\n|\n|\r/);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const endLeft = left.length - suffix, endRight = right.length - suffix;
  const n = endLeft - prefix, m = endRight - prefix;
  const exact = (n + 1) * (m + 1) <= maxCells;
  const operations = [];
  for (let i = 0; i < prefix; i++) operations.push({ kind: 'equal', left: i, right: i });
  if (exact) {
    const columns = m + 1;
    const lengths = new Uint32Array((n + 1) * columns);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * columns + j] = left[prefix + i] === right[prefix + j]
          ? lengths[(i + 1) * columns + j + 1] + 1
          : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && left[prefix + i] === right[prefix + j]) {
        operations.push({ kind: 'equal', left: prefix + i++, right: prefix + j++ });
      } else if (i < n && (j === m || lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1])) {
        operations.push({ kind: 'removed', left: prefix + i++ });
      } else {
        operations.push({ kind: 'added', right: prefix + j++ });
      }
    }
  } else {
    // Bound memory and work for large unrelated documents. The view labels this mode.
    for (let i = 0; i < Math.max(n, m); i++) {
      if (i < n && i < m && left[prefix + i] === right[prefix + i]) operations.push({ kind: 'equal', left: prefix + i, right: prefix + i });
      else {
        if (i < n) operations.push({ kind: 'removed', left: prefix + i });
        if (i < m) operations.push({ kind: 'added', right: prefix + i });
      }
    }
  }
  for (let i = 0; i < suffix; i++) operations.push({ kind: 'equal', left: endLeft + i, right: endRight + i });
  const rows = [];
  let added = 0, removed = 0;
  const cell = (source, index) => index === undefined ? null : { number: index + 1, text: source[index] };
  for (let i = 0; i < operations.length;) {
    const operation = operations[i];
    if (operation.kind === 'equal') {
      rows.push({ kind: 'equal', left: cell(left, operation.left), right: cell(right, operation.right) });
      i++;
      continue;
    }
    const deletions = [], insertions = [];
    while (i < operations.length && operations[i].kind !== 'equal') {
      const edit = operations[i++];
      if (edit.kind === 'removed') deletions.push(edit.left);
      else insertions.push(edit.right);
    }
    removed += deletions.length; added += insertions.length;
    for (let j = 0; j < Math.max(deletions.length, insertions.length); j++) {
      const a = cell(left, deletions[j]), b = cell(right, insertions[j]);
      rows.push({ kind: a && b ? 'changed' : a ? 'removed' : 'added', left: a, right: b });
    }
  }
  return {
    rows, exact, added, removed,
    identical: originalLeft === originalRight,
    lineEndingsOnly: originalLeft !== originalRight && added === 0 && removed === 0,
  };
}
