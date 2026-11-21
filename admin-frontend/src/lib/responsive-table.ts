let cleanupFns: Array<() => void> = [];
const boundScrollableShells = new WeakSet<HTMLElement>();
const MIN_RESIZABLE_COLUMN_WIDTH = 56;

type HeaderMeta = {
  label: string;
  role: 'default' | 'actions' | 'selection';
};

function normalizeLabel(value: string, fallbackIndex: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text;
  }
  return `字段 ${fallbackIndex + 1}`;
}

function resolveHeaderRole(cell: HTMLElement, label: string): HeaderMeta['role'] {
  if (cell.querySelector('.el-checkbox')) {
    return 'selection';
  }

  if (/^(操作|actions?)$/i.test(label)) {
    return 'actions';
  }

  return 'default';
}

function extractHeaderMeta(table: HTMLElement): HeaderMeta[] {
  const headerRow = table.querySelector(
    '.el-table__header-wrapper thead tr',
  ) as HTMLTableRowElement | null;

  if (!headerRow) {
    return [];
  }

  return Array.from(headerRow.children)
    .filter((cell) => cell instanceof HTMLElement)
    .map((cell, index) => {
      const labelNode = (cell as HTMLElement).querySelector('.cell');
      const label = normalizeLabel(labelNode?.textContent || '', index);

      return {
        label,
        role: resolveHeaderRole(cell as HTMLElement, label),
      };
    });
}

function ensureTableShell(table: HTMLElement) {
  const existingShell = table.closest('.table-shell');
  if (existingShell instanceof HTMLElement) {
    existingShell.classList.add('ws-table-shell', 'ws-table-shell--managed');
    existingShell.dataset.tableShell = 'ready';
    return existingShell;
  }

  const parent = table.parentElement;
  if (!parent) {
    return null;
  }

  const shell = document.createElement('div');
  shell.className = 'table-shell ws-table-shell ws-table-shell--auto ws-table-shell--managed';
  shell.dataset.tableShell = 'ready';
  parent.insertBefore(shell, table);
  shell.appendChild(table);
  return shell;
}

function forceOpaqueFixedColumns(table: HTMLElement) {
  const fixedMode = table.dataset.fixedMode || 'disabled';

  if (fixedMode === 'left-only') {
    table.removeAttribute('data-fixed-disabled');

    const rightFixedWrappers = table.querySelectorAll(
      '.el-table__fixed-right, .el-table__fixed-right-patch',
    );
    rightFixedWrappers.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      node.style.display = 'none';
      node.style.width = '0';
      node.style.minWidth = '0';
      node.style.maxWidth = '0';
      node.style.overflow = 'hidden';
      node.style.boxShadow = 'none';
    });

    const rightStickyCells = table.querySelectorAll('.el-table-fixed-column--right');
    rightStickyCells.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      node.style.position = 'static';
      node.style.left = 'auto';
      node.style.right = 'auto';
      node.style.zIndex = 'auto';
      node.style.boxShadow = 'none';
      node.style.background = 'inherit';
      node.style.backgroundColor = 'inherit';
      node.style.backgroundImage = 'none';
    });

    const leftFixedNodes = table.querySelectorAll(
      '.el-table__fixed, .el-table-fixed-column--left',
    );
    leftFixedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      node.style.display = '';
      node.style.width = '';
      node.style.minWidth = '';
      node.style.maxWidth = '';
      node.style.overflow = '';
      node.style.background = '#f8fbfc';
      node.style.backgroundColor = '#f8fbfc';
      node.style.backgroundImage = 'none';
      node.style.backdropFilter = 'none';
      (node.style as any).webkitBackdropFilter = 'none';
      node.style.opacity = '1';
      node.style.boxShadow = '';
    });

    return;
  }

  table.setAttribute('data-fixed-disabled', 'true');

  const fixedWrappers = table.querySelectorAll(
    '.el-table__fixed, .el-table__fixed-right, .el-table__fixed-right-patch, .el-table__fixed-left-patch',
  );
  fixedWrappers.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    node.style.display = 'none';
    node.style.width = '0';
    node.style.minWidth = '0';
    node.style.maxWidth = '0';
    node.style.overflow = 'hidden';
    node.style.boxShadow = 'none';
  });

  const stickyCells = table.querySelectorAll(
    '.el-table-fixed-column--left, .el-table-fixed-column--right',
  );
  stickyCells.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    node.style.position = 'static';
    node.style.left = 'auto';
    node.style.right = 'auto';
    node.style.zIndex = 'auto';
    node.style.boxShadow = 'none';
    node.style.background = 'inherit';
    node.style.backgroundColor = 'inherit';
    node.style.backgroundImage = 'none';
  });
}

function resolveHorizontalScrollHost(
  table: HTMLElement,
  source?: EventTarget | null,
) {
  const candidates = [
    source instanceof HTMLElement ? source : null,
    table.querySelector('.el-scrollbar__wrap'),
    table.querySelector('.el-table__body-wrapper'),
    table.querySelector('.el-table__header-wrapper'),
  ].filter((item): item is HTMLElement => item instanceof HTMLElement);

  return (
    candidates.find((item) => item.scrollWidth - item.clientWidth > 1)
    || candidates[0]
    || null
  );
}

function updateFixedColumnOpacityState(
  table: HTMLElement,
  shell: HTMLElement,
  source?: EventTarget | null,
) {
  if (table.dataset.fixedDisabled === 'true') {
    shell.dataset.scrollLeftCovered = 'false';
    shell.dataset.scrollRightCovered = 'false';
    shell.dataset.scrollXActive = 'false';
    return;
  }

  const host = resolveHorizontalScrollHost(table, source);
  if (!host) {
    shell.dataset.scrollLeftCovered = 'false';
    shell.dataset.scrollRightCovered = 'false';
    shell.dataset.scrollXActive = 'false';
    return;
  }

  const maxScrollLeft = Math.max(0, host.scrollWidth - host.clientWidth);
  const scrollLeft = Math.max(0, host.scrollLeft);

  shell.dataset.scrollXActive = maxScrollLeft > 0 ? 'true' : 'false';
  shell.dataset.scrollLeftCovered = scrollLeft > 0 ? 'true' : 'false';
  shell.dataset.scrollRightCovered = scrollLeft < maxScrollLeft - 1 ? 'true' : 'false';
}

function bindManagedTableScrollState(table: HTMLElement, shell: HTMLElement) {
  if (boundScrollableShells.has(shell)) {
    updateFixedColumnOpacityState(table, shell);
    return;
  }

  const handleScroll = (event: Event) => {
    updateFixedColumnOpacityState(table, shell, event.target);
  };

  shell.addEventListener('scroll', handleScroll, true);
  updateFixedColumnOpacityState(table, shell);
  boundScrollableShells.add(shell);
  cleanupFns.push(() => {
    shell.removeEventListener('scroll', handleScroll, true);
  });
}

function findPageRoot(node: HTMLElement) {
  let current: HTMLElement | null = node;

  while (current?.parentElement) {
    if (current.parentElement.classList.contains('dashboard-main-shell')) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function enhancePageRoot(pageRoot: HTMLElement) {
  pageRoot.classList.add('ws-data-page');

  const directChildren = Array.from(pageRoot.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  const titleNode = directChildren.find(
    (child) =>
      /^(H1|H2)$/.test(child.tagName) || child.classList.contains('page-title'),
  );
  if (titleNode) {
    titleNode.classList.add('ws-page-title');
  }

  const subtitleNode = directChildren.find(
    (child) =>
      child !== titleNode &&
      (child.tagName === 'P' ||
        child.classList.contains('page-desc') ||
        child.classList.contains('page-subtitle') ||
        child.classList.contains('students-page__tip')),
  );
  if (subtitleNode) {
    subtitleNode.classList.add('ws-page-subtitle');
  }

  directChildren.forEach((child) => {
    if (
      child.matches('.toolbar, .search-bar, .page-header, .toolbar-row, .actions') ||
      (!child.className &&
        child.tagName === 'DIV' &&
        child.querySelector('.el-button') &&
        !child.querySelector('.el-table'))
    ) {
      child.classList.add('ws-data-toolbar');
    }

    if (child.matches('.pagination, .pagination-container, .pager')) {
      child.classList.add('ws-data-pagination');
    }

    if (child.matches('.table-shell')) {
      child.classList.add('ws-data-table-shell');
    }

    if (child.matches('.el-card')) {
      child.classList.add('ws-data-card');
    }
  });

  pageRoot
    .querySelectorAll('.detail-section, .report-history, .report-types, .section-header')
    .forEach((node) => {
      if (node instanceof HTMLElement) {
        node.classList.add('ws-data-section');
      }
    });

  const hasManualWorkbench = directChildren.some((child) => {
    const classText = String(child.className || '');
    return /hero|overview/.test(classText);
  });

  if (!hasManualWorkbench) {
    ensureAutoWorkbench(pageRoot, directChildren, titleNode, subtitleNode);
  }
}

function ensureAutoWorkbench(
  pageRoot: HTMLElement,
  directChildren: HTMLElement[],
  titleNode?: HTMLElement,
  subtitleNode?: HTMLElement,
) {
  if (!titleNode) {
    return;
  }

  let autoHero = pageRoot.querySelector(':scope > .ws-auto-hero') as HTMLElement | null;

  if (!autoHero) {
    autoHero = document.createElement('section');
    autoHero.className = 'ws-auto-hero';

    const copy = document.createElement('div');
    copy.className = 'ws-auto-hero__copy';
    autoHero.appendChild(copy);

    const actions = document.createElement('div');
    actions.className = 'ws-auto-hero__actions';
    autoHero.appendChild(actions);

    pageRoot.insertBefore(autoHero, pageRoot.firstChild);
  }

  const copy = autoHero.querySelector('.ws-auto-hero__copy') as HTMLElement | null;
  const actions = autoHero.querySelector('.ws-auto-hero__actions') as HTMLElement | null;

  if (copy && titleNode.parentElement !== copy) {
    copy.appendChild(titleNode);
  }

  if (copy && subtitleNode && subtitleNode.parentElement !== copy) {
    copy.appendChild(subtitleNode);
  }

  if (actions) {
    const toolbarNodes = directChildren.filter((child) => child.classList.contains('ws-data-toolbar'));
    toolbarNodes.forEach((toolbar) => {
      if (toolbar.parentElement !== actions) {
        actions.appendChild(toolbar);
      }
    });
  }
}

function getLeafHeaderCells(table: HTMLElement) {
  const headerRow = table.querySelector(
    '.el-table__header-wrapper thead tr:last-child',
  ) as HTMLTableRowElement | null;

  if (!headerRow) {
    return [] as HTMLElement[];
  }

  return Array.from(headerRow.children).filter((cell): cell is HTMLElement => {
    return (
      cell instanceof HTMLElement
      && cell.matches('th.el-table__cell')
      && !cell.classList.contains('gutter')
      && cell.colSpan === 1
    );
  });
}

function readStoredColumnWidths(table: HTMLElement) {
  try {
    const raw = table.dataset.wsColumnWidths;
    if (!raw) {
      return {} as Record<string, number>;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {} as Record<string, number>;
  }
}

function writeStoredColumnWidths(table: HTMLElement, nextWidths: Record<string, number>) {
  table.dataset.wsColumnWidths = JSON.stringify(nextWidths);
}

let sharedMeasureCanvas: HTMLCanvasElement | null = null;

function getTextMeasurer(font: string) {
  if (typeof document === 'undefined') {
    return (text: string) => String(text || '').length * 8;
  }
  if (!sharedMeasureCanvas) {
    sharedMeasureCanvas = document.createElement('canvas');
  }
  const ctx = sharedMeasureCanvas.getContext('2d');
  if (!ctx) {
    return (text: string) => String(text || '').length * 8;
  }
  ctx.font = font;
  return (text: string) => Math.ceil(ctx.measureText(String(text || '')).width);
}

function setColumnWidthInternal(
  table: HTMLElement,
  columnIndex: number,
  width: number,
  persist: boolean,
) {
  const safeWidth = Math.max(MIN_RESIZABLE_COLUMN_WIDTH, Math.round(width));
  const widthText = `${safeWidth}px`;

  const innerTables = table.querySelectorAll('table');
  innerTables.forEach((innerTable) => {
    if (!(innerTable instanceof HTMLTableElement)) {
      return;
    }

    const cols = Array.from(innerTable.querySelectorAll('colgroup > col')).filter((col) => {
      return col instanceof HTMLElement && col.getAttribute('name') !== 'gutter';
    }) as HTMLElement[];

    const targetCol = cols[columnIndex];
    if (!targetCol) {
      return;
    }

    targetCol.setAttribute('width', String(safeWidth));
    targetCol.style.width = widthText;
    targetCol.style.minWidth = widthText;
    targetCol.style.maxWidth = widthText;
  });

  const headerCells = getLeafHeaderCells(table);
  const targetHeader = headerCells[columnIndex];
  if (targetHeader) {
    targetHeader.style.width = widthText;
    targetHeader.style.minWidth = widthText;
    targetHeader.style.maxWidth = widthText;
  }

  if (persist) {
    const storedWidths = readStoredColumnWidths(table);
    storedWidths[String(columnIndex)] = safeWidth;
    writeStoredColumnWidths(table, storedWidths);
  }
}

function applyColumnWidth(table: HTMLElement, columnIndex: number, width: number) {
  setColumnWidthInternal(table, columnIndex, width, true);
}

function measureStructuredCellContent(
  cell: HTMLElement,
  measureBody: (text: string) => number,
  padX: number,
) {
  const inner = (cell.querySelector('.cell') as HTMLElement | null) || cell;
  const buttons = Array.from(inner.querySelectorAll('.el-button')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const tags = Array.from(inner.querySelectorAll('.el-tag')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );

  // Action or button-row cells: keep all visible buttons on one clean line
  if (buttons.length > 0) {
    let totalBtnWidth = 0;
    buttons.forEach((btn, idx) => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      const isLink = btn.classList.contains('is-link') || btn.classList.contains('el-button--link');
      const btnPad = isLink ? 10 : 28;
      totalBtnWidth += measureBody(label) + btnPad;
      if (idx > 0) {
        totalBtnWidth += 8;
      }
    });
    return {
      width: totalBtnWidth + padX + 8,
      kind: 'actions' as const,
    };
  }

  // Multi-line summary container (e.g., two stat lines stacked inside .session-stats)
  const blockChildren = Array.from(inner.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'DIV',
  );
  if (blockChildren.length > 1) {
    let maxLineWidth = 0;
    blockChildren.forEach((line) => {
      const text = (line.textContent || '').replace(/\s+/g, ' ').trim();
      const childTags = line.querySelectorAll('.el-tag').length;
      const lineW = measureBody(text) + childTags * 22;
      if (lineW > maxLineWidth) {
        maxLineWidth = lineW;
      }
    });
    return {
      width: maxLineWidth + padX + 14,
      kind: 'compact' as const,
    };
  }

  // Tag-heavy cells
  if (tags.length > 0) {
    let totalTagWidth = 0;
    tags.forEach((tag, idx) => {
      const text = (tag.textContent || '').replace(/\s+/g, ' ').trim();
      totalTagWidth += measureBody(text) + 28;
      if (idx > 0) {
        totalTagWidth += 6;
      }
    });
    return {
      width: totalTagWidth + padX + 8,
      kind: 'tag' as const,
    };
  }

  const hasTooltip = inner.classList.contains('el-tooltip') || Boolean(inner.querySelector('.el-tooltip'));
  const text = (inner.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    width: measureBody(text) + padX + 14,
    kind: hasTooltip ? ('tooltip' as const) : ('text' as const),
  };
}

function autoFitTableColumns(table: HTMLElement, headers: HeaderMeta[]) {
  if (table.dataset.wsManualResized === 'true') {
    return;
  }

  const headerCells = getLeafHeaderCells(table);
  if (!headerCells.length || headerCells.length !== headers.length) {
    return;
  }

  const bodyRows = Array.from(
    table.querySelectorAll('.el-table__body-wrapper tbody tr'),
  ).filter((row): row is HTMLElement => {
    if (!(row instanceof HTMLElement)) {
      return false;
    }
    const firstTd = row.querySelector('td.el-table__cell') as HTMLTableCellElement | null;
    return Boolean(firstTd && firstTd.colSpan === 1);
  });

  const sampleRows = bodyRows.slice(0, 25);
  const bodyWrapper = table.querySelector('.el-table__body-wrapper') as HTMLElement | null;
  const viewportWidth = Math.max(
    0,
    Math.floor((bodyWrapper?.clientWidth || table.clientWidth || 0) - 2),
  );

  // Build compact content + width fingerprint so identical renders are skipped cleanly
  const rowFingerprints = sampleRows
    .map((row) =>
      Array.from(row.querySelectorAll('td.el-table__cell'))
        .map((td) => (td.textContent || '').trim().length)
        .join(','),
    )
    .join(';');
  const signature = `${headers.map((h) => h.label).join('|')}::${bodyRows.length}::${rowFingerprints}::${Math.round(viewportWidth / 16)}`;
  if (table.dataset.wsAutoFitSig === signature) {
    return;
  }

  const firstTh = headerCells[0];
  const thStyle = typeof window !== 'undefined' ? window.getComputedStyle(firstTh) : null;
  const headerFont = thStyle ? `${thStyle.fontWeight || '700'} ${thStyle.fontSize || '12px'} ${thStyle.fontFamily || 'sans-serif'}` : '700 12px sans-serif';
  const headerPadX = thStyle
    ? Math.ceil((parseFloat(thStyle.paddingLeft) || 14) + (parseFloat(thStyle.paddingRight) || 14))
    : 28;

  const firstTd = sampleRows[0]?.querySelector('td.el-table__cell') as HTMLElement | null;
  const tdStyle = firstTd && typeof window !== 'undefined' ? window.getComputedStyle(firstTd) : null;
  const bodyFont = tdStyle ? `${tdStyle.fontWeight || '400'} ${tdStyle.fontSize || '13px'} ${tdStyle.fontFamily || 'sans-serif'}` : '400 13px sans-serif';
  const bodyPadX = tdStyle
    ? Math.ceil((parseFloat(tdStyle.paddingLeft) || 14) + (parseFloat(tdStyle.paddingRight) || 14))
    : 28;

  const measureHeader = getTextMeasurer(headerFont);
  const measureBody = getTextMeasurer(bodyFont);

  const columnKinds: Array<'selection' | 'actions' | 'tag' | 'compact' | 'tooltip' | 'text'> = [];
  const headerMinWidths: number[] = [];

  const neededWidths = headers.map((header, colIdx) => {
    if (header.role === 'selection') {
      columnKinds[colIdx] = 'selection';
      headerMinWidths[colIdx] = 48;
      return 48;
    }

    const headerNeeded = Math.max(MIN_RESIZABLE_COLUMN_WIDTH, measureHeader(header.label) + headerPadX + 10);
    headerMinWidths[colIdx] = headerNeeded;

    let maxContentWidth = 0;
    let kind: 'actions' | 'tag' | 'compact' | 'tooltip' | 'text' =
      header.role === 'actions' ? 'actions' : 'text';

    sampleRows.forEach((row) => {
      const cells = row.querySelectorAll('td.el-table__cell');
      const cell = cells[colIdx];
      if (!(cell instanceof HTMLElement)) {
        return;
      }
      const measured = measureStructuredCellContent(cell, measureBody, bodyPadX);
      if (measured.width > maxContentWidth) {
        maxContentWidth = measured.width;
      }
      if (measured.kind === 'actions') {
        kind = 'actions';
      } else if (kind !== 'actions' && measured.kind === 'tooltip') {
        kind = 'tooltip';
      } else if (kind === 'text' && (measured.kind === 'tag' || measured.kind === 'compact')) {
        kind = measured.kind;
      }
    });

    columnKinds[colIdx] = kind;
    const rawNeeded = Math.max(headerNeeded, maxContentWidth);
    if (kind === 'actions') {
      return Math.min(360, rawNeeded);
    }
    if (kind === 'tag') {
      return Math.min(160, rawNeeded);
    }
    if (kind === 'tooltip') {
      return Math.min(240, rawNeeded);
    }
    return Math.min(260, rawNeeded);
  });

  const sumNeeded = neededWidths.reduce((sum, w) => sum + w, 0);
  const finalWidths = [...neededWidths];

  if (viewportWidth > 0 && sumNeeded < viewportWidth) {
    let expandableIndices = columnKinds
      .map((kind, idx) => (kind === 'text' || kind === 'tooltip' ? idx : -1))
      .filter((idx) => idx >= 0);

    if (expandableIndices.length === 0) {
      expandableIndices = columnKinds
        .map((kind, idx) => (kind !== 'selection' && kind !== 'actions' ? idx : -1))
        .filter((idx) => idx >= 0);
    }

    if (expandableIndices.length > 0) {
      const extra = viewportWidth - sumNeeded;
      const baseSum = expandableIndices.reduce((sum, idx) => sum + neededWidths[idx], 0) || 1;
      let assigned = 0;
      expandableIndices.forEach((idx, pos) => {
        const share =
          pos === expandableIndices.length - 1
            ? extra - assigned
            : Math.floor((extra * neededWidths[idx]) / baseSum);
        finalWidths[idx] = neededWidths[idx] + Math.max(0, share);
        assigned += Math.max(0, share);
      });
    }
  } else if (viewportWidth > 0 && sumNeeded > viewportWidth && sumNeeded <= viewportWidth * 1.35) {
    // Fit moderately wide tables cleanly into the viewport without horizontal scrollbars
    let excess = sumNeeded - viewportWidth;
    const passGroups: number[][] = [
      columnKinds
        .map((kind, idx) => (kind === 'tooltip' || kind === 'text' || kind === 'compact' ? idx : -1))
        .filter((idx) => idx >= 0),
      columnKinds
        .map((kind, idx) => (kind === 'tag' ? idx : -1))
        .filter((idx) => idx >= 0),
    ];

    for (const group of passGroups) {
      if (excess <= 0) {
        break;
      }
      const totalSlack = group.reduce(
        (sum, idx) => sum + Math.max(0, finalWidths[idx] - headerMinWidths[idx]),
        0,
      );
      if (totalSlack <= 0) {
        continue;
      }
      const trimTarget = Math.min(excess, totalSlack);
      let trimmed = 0;
      group.forEach((idx, pos) => {
        const slack = Math.max(0, finalWidths[idx] - headerMinWidths[idx]);
        if (slack <= 0) {
          return;
        }
        const cut =
          pos === group.length - 1
            ? Math.min(slack, trimTarget - trimmed)
            : Math.min(slack, Math.floor((trimTarget * slack) / totalSlack));
        finalWidths[idx] -= cut;
        trimmed += cut;
      });
      excess -= trimmed;
    }
  }

  const totalFinalWidth = finalWidths.reduce((sum, w) => sum + w, 0);
  table.dataset.wsAutoFitSig = signature;

  finalWidths.forEach((width, colIdx) => {
    setColumnWidthInternal(table, colIdx, width, false);
  });

  table.querySelectorAll('.el-table__header, .el-table__body').forEach((innerTable) => {
    if (innerTable instanceof HTMLTableElement) {
      innerTable.style.width = `${totalFinalWidth}px`;
    }
  });
}

function applyStoredColumnWidths(table: HTMLElement) {
  const storedWidths = readStoredColumnWidths(table);
  Object.entries(storedWidths).forEach(([indexText, width]) => {
    const index = Number(indexText);
    const numericWidth = Number(width);
    if (!Number.isFinite(index) || !Number.isFinite(numericWidth)) {
      return;
    }

    applyColumnWidth(table, index, numericWidth);
  });
}

function startLeftEdgeResize(
  table: HTMLElement,
  columnIndex: number,
  startEvent: MouseEvent,
) {
  const headerCells = getLeafHeaderCells(table);
  const previousCell = headerCells[columnIndex - 1];
  const targetCell = headerCells[columnIndex];
  if (!previousCell || !targetCell) {
    return;
  }

  const startPreviousWidth = previousCell.getBoundingClientRect().width;
  const startWidth = targetCell.getBoundingClientRect().width;
  const startX = startEvent.clientX;

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  table.dataset.wsManualResized = 'true';
  table.classList.add('ws-table-resizing');

  const handleMouseMove = (moveEvent: MouseEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const minDelta = MIN_RESIZABLE_COLUMN_WIDTH - startPreviousWidth;
    const maxDelta = startWidth - MIN_RESIZABLE_COLUMN_WIDTH;
    const boundedDelta = Math.min(maxDelta, Math.max(minDelta, deltaX));

    applyColumnWidth(table, columnIndex - 1, startPreviousWidth + boundedDelta);
    applyColumnWidth(table, columnIndex, startWidth - boundedDelta);
  };

  const handleMouseUp = () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    table.classList.remove('ws-table-resizing');
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function bindLeftResizeHandles(table: HTMLElement) {
  const headerCells = getLeafHeaderCells(table);
  if (headerCells.length <= 1) {
    return;
  }

  table
    .querySelectorAll('.ws-col-left-resizer')
    .forEach((node) => node.parentNode?.removeChild(node));

  headerCells.forEach((cell, index) => {
    if (index === 0) {
      return;
    }

    cell.classList.add('ws-col-resizable');

    const handle = document.createElement('span');
    handle.className = 'ws-col-left-resizer';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      startLeftEdgeResize(table, index, event);
    });
    cell.appendChild(handle);
  });
}

function applyLabelsToTable(table: HTMLElement) {
  const headers = extractHeaderMeta(table);
  if (!headers.length) {
    return;
  }

  const shell = ensureTableShell(table);
  const pageRoot = findPageRoot(table);
  if (pageRoot) {
    enhancePageRoot(pageRoot);
  }
  forceOpaqueFixedColumns(table);

  if (shell) {
    shell.dataset.tableColumns = String(headers.length);
    shell.dataset.hasActions = headers.some((item) => item.role === 'actions') ? 'true' : 'false';
    bindManagedTableScrollState(table, shell);
  }
  autoFitTableColumns(table, headers);
  applyStoredColumnWidths(table);
  bindLeftResizeHandles(table);
  const bodyRows = table.querySelectorAll(
    '.el-table__body-wrapper tbody tr',
  );

  bodyRows.forEach((row) => {
    const cells = row.querySelectorAll('td.el-table__cell');
    cells.forEach((cell, index) => {
      const header = headers[index] || { label: normalizeLabel('', index), role: 'default' as const };
      (cell as HTMLElement).setAttribute('data-label', header.label);
      (cell as HTMLElement).setAttribute('data-column-role', header.role);
      const innerCell = (cell as HTMLElement).querySelector('.cell') as HTMLElement | null;
      if (innerCell) {
        innerCell.setAttribute('data-label', header.label);
        innerCell.setAttribute('data-column-role', header.role);
      }
    });
  });

  table.setAttribute('data-responsive-table', 'ready');
  table.setAttribute('data-table-columns', String(headers.length));
  table.setAttribute(
    'data-table-has-actions',
    headers.some((item) => item.role === 'actions') ? 'true' : 'false',
  );
}

function refreshResponsiveTables(root: ParentNode = document) {
  const tables = root.querySelectorAll('.el-table');
  tables.forEach((table) => {
    if (table instanceof HTMLElement) {
      applyLabelsToTable(table);
    }
  });
}

export function initResponsiveTableEnhancer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => void 0;
  }

  let rafId = 0;
  const scheduleRefresh = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      refreshResponsiveTables(document);
      rafId = 0;
    });
  };

  const observer = new MutationObserver(() => {
    scheduleRefresh();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('resize', scheduleRefresh);
  scheduleRefresh();

  const cleanup = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    observer.disconnect();
    window.removeEventListener('resize', scheduleRefresh);
  };

  cleanupFns.push(cleanup);
  return cleanup;
}

export function disposeResponsiveTableEnhancer() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
