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
  table.removeAttribute('data-fixed-disabled');

  const fixedWrappers = table.querySelectorAll(
    '.el-table__fixed, .el-table__fixed-right, .el-table__fixed-right-patch, .el-table__fixed-left-patch',
  );
  fixedWrappers.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    if (fixedMode === 'left-only' && node.classList.contains('el-table__fixed')) {
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
      return;
    }

    node.style.display = 'none';
    node.style.width = '0';
    node.style.minWidth = '0';
    node.style.maxWidth = '0';
    node.style.overflow = 'hidden';
    node.style.boxShadow = 'none';
  });

  // Left fixed columns keep previous opt-in semantics, while right action column pinning
  // is handled uniformly on CSS via .ws-sticky-action-col when overflowing horizontally.
  const leftStickyCells = table.querySelectorAll('.el-table-fixed-column--left');
  leftStickyCells.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    if (fixedMode === 'left-only') {
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
      node.style.position = '';
      node.style.left = '';
      node.style.zIndex = '';
    } else {
      node.style.position = 'static';
      node.style.left = 'auto';
      node.style.zIndex = 'auto';
      node.style.boxShadow = 'none';
      node.style.background = 'inherit';
      node.style.backgroundColor = 'inherit';
      node.style.backgroundImage = 'none';
    }
  });

  const rightStickyCells = table.querySelectorAll('.el-table-fixed-column--right');
  rightStickyCells.forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.style.position = '';
    node.style.right = '';
    node.style.zIndex = '';
    node.style.boxShadow = '';
    node.style.background = '';
    node.style.backgroundColor = '';
    node.style.backgroundImage = '';
  });
}

function syncStickyActionColumn(table: HTMLElement, headers: HeaderMeta[]) {
  let actionColIndex = -1;
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    if (headers[i].role === 'actions') {
      actionColIndex = i;
      break;
    }
  }

  const headerCells = getLeafHeaderCells(table);
  headerCells.forEach((cell, idx) => {
    cell.classList.toggle('ws-sticky-action-col', idx === actionColIndex);
  });

  const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr');
  bodyRows.forEach((row) => {
    const cells = row.querySelectorAll('td.el-table__cell');
    cells.forEach((cell, idx) => {
      if (cell instanceof HTMLElement) {
        cell.classList.toggle('ws-sticky-action-col', idx === actionColIndex);
      }
    });
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

function ensureTopHorizontalScrollbar(table: HTMLElement, shell: HTMLElement) {
  let topScroll = shell.querySelector(':scope > .ws-table-top-scroll') as HTMLDivElement | null;
  if (!topScroll) {
    topScroll = document.createElement('div');
    topScroll.className = 'ws-table-top-scroll';
    topScroll.setAttribute('aria-hidden', 'true');
    const track = document.createElement('div');
    track.className = 'ws-table-top-scroll__track';
    topScroll.appendChild(track);
    shell.insertBefore(topScroll, table);
  }
  const track = topScroll.querySelector(':scope > .ws-table-top-scroll__track') as HTMLDivElement | null;
  return { topScroll, track };
}

function updateScrollCoveredState(
  table: HTMLElement,
  shell: HTMLElement,
  source?: EventTarget | null,
) {
  const host = resolveHorizontalScrollHost(table, source);
  const { topScroll, track } = ensureTopHorizontalScrollbar(table, shell);
  if (!host) {
    shell.dataset.scrollLeftCovered = 'false';
    shell.dataset.scrollRightCovered = 'false';
    shell.dataset.scrollXActive = 'false';
    shell.dataset.hasHorizontalOverflow = 'false';
    if (track) track.style.width = '0px';
    return;
  }

  const maxScrollLeft = Math.max(0, host.scrollWidth - host.clientWidth);
  const hasOverflow = maxScrollLeft > 2;
  const scrollLeft = Math.max(0, host.scrollLeft);

  shell.dataset.hasHorizontalOverflow = hasOverflow ? 'true' : 'false';
  shell.dataset.scrollXActive = hasOverflow ? 'true' : 'false';
  shell.dataset.scrollLeftCovered = hasOverflow && scrollLeft > 1 ? 'true' : 'false';
  shell.dataset.scrollRightCovered = hasOverflow && scrollLeft < maxScrollLeft - 2 ? 'true' : 'false';

  if (hasOverflow) {
    topScroll.style.width = `${host.clientWidth}px`;
    if (track) {
      track.style.width = `${host.scrollWidth}px`;
    }
    if (Math.abs(topScroll.scrollLeft - scrollLeft) > 1) {
      topScroll.scrollLeft = scrollLeft;
    }
  } else {
    topScroll.style.width = '';
    if (track) {
      track.style.width = '0px';
    }
  }
}

function bindManagedTableScrollState(table: HTMLElement, shell: HTMLElement) {
  updateScrollCoveredState(table, shell);

  if (boundScrollableShells.has(shell)) {
    return;
  }

  const { topScroll } = ensureTopHorizontalScrollbar(table, shell);

  const handleTopScroll = () => {
    const host = resolveHorizontalScrollHost(table);
    if (!host) {
      return;
    }
    if (Math.abs(host.scrollLeft - topScroll.scrollLeft) > 1) {
      host.scrollLeft = topScroll.scrollLeft;
    }
    updateScrollCoveredState(table, shell, host);
  };

  const handleBodyScroll = (event: Event) => {
    if (event.target === topScroll) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target
      && !target.classList.contains('el-scrollbar__wrap')
      && !target.classList.contains('el-table__body-wrapper')
      && !target.classList.contains('el-table__header-wrapper')
    ) {
      return;
    }
    const host = resolveHorizontalScrollHost(table, target);
    if (!host) {
      return;
    }
    if (Math.abs(topScroll.scrollLeft - host.scrollLeft) > 1) {
      topScroll.scrollLeft = host.scrollLeft;
    }
    updateScrollCoveredState(table, shell, host);
  };

  const handleShiftWheel = (event: WheelEvent) => {
    if (!event.shiftKey || event.deltaY === 0) {
      return;
    }
    const host = resolveHorizontalScrollHost(table);
    if (!host || host.scrollWidth - host.clientWidth <= 2) {
      return;
    }
    const prev = host.scrollLeft;
    host.scrollLeft += event.deltaY;
    if (host.scrollLeft !== prev) {
      event.preventDefault();
      if (Math.abs(topScroll.scrollLeft - host.scrollLeft) > 1) {
        topScroll.scrollLeft = host.scrollLeft;
      }
      updateScrollCoveredState(table, shell, host);
    }
  };

  let lastObservedWidth = Math.round(shell.clientWidth);
  let resizeRaf = 0;
  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const nextWidth = Math.round(shell.clientWidth);
          if (Math.abs(nextWidth - lastObservedWidth) < 2) {
            return;
          }
          lastObservedWidth = nextWidth;
          if (resizeRaf) {
            cancelAnimationFrame(resizeRaf);
          }
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (table.isConnected) {
              applyLabelsToTable(table);
            }
          });
        })
      : null;

  topScroll.addEventListener('scroll', handleTopScroll, { passive: true });
  shell.addEventListener('scroll', handleBodyScroll, true);
  table.addEventListener('wheel', handleShiftWheel, { passive: false });
  resizeObserver?.observe(shell);

  boundScrollableShells.add(shell);
  cleanupFns.push(() => {
    topScroll.removeEventListener('scroll', handleTopScroll);
    shell.removeEventListener('scroll', handleBodyScroll, true);
    table.removeEventListener('wheel', handleShiftWheel);
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    resizeObserver?.disconnect();
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

function syncTooltipCellWidths(table: HTMLElement) {
  const bodyRows = table.querySelectorAll('.el-table__body-wrapper tbody tr');
  if (!bodyRows.length) {
    return;
  }

  if (typeof window !== 'undefined' && window.innerWidth <= 960) {
    bodyRows.forEach((row) => {
      row.querySelectorAll('td.el-table__cell .cell.el-tooltip').forEach((node) => {
        if (node instanceof HTMLElement && node.style.width) {
          node.style.width = '';
        }
      });
    });
    return;
  }

  const bodyTable = table.querySelector('.el-table__body-wrapper table');
  const cols = bodyTable
    ? (Array.from(bodyTable.querySelectorAll('colgroup > col')).filter(
        (col) => col instanceof HTMLElement && col.getAttribute('name') !== 'gutter',
      ) as HTMLElement[])
    : [];

  let cachedTdPadX: number | null = null;
  const getTdPadX = (td: HTMLElement) => {
    if (cachedTdPadX !== null) {
      return cachedTdPadX;
    }
    if (typeof window === 'undefined') {
      cachedTdPadX = 28;
      return cachedTdPadX;
    }
    const style = window.getComputedStyle(td);
    cachedTdPadX = Math.ceil(
      (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0),
    );
    return cachedTdPadX;
  };

  bodyRows.forEach((row) => {
    const cells = row.querySelectorAll('td.el-table__cell');
    cells.forEach((cell, colIdx) => {
      if (!(cell instanceof HTMLTableCellElement) || cell.colSpan > 1) {
        return;
      }
      const tooltipCell = cell.querySelector('.cell.el-tooltip') as HTMLElement | null;
      if (!tooltipCell) {
        return;
      }

      const col = cols[colIdx];
      const colWidth =
        parseFloat(col?.style.width || '') ||
        parseFloat(col?.getAttribute('width') || '') ||
        Math.floor(cell.getBoundingClientRect().width);
      if (!Number.isFinite(colWidth) || colWidth <= 0) {
        return;
      }

      if (tooltipCell.dataset.wsOrigTooltipWidth === undefined) {
        tooltipCell.dataset.wsOrigTooltipWidth = tooltipCell.style.width || '';
      }

      const targetWidth = Math.max(40, Math.floor(colWidth - getTdPadX(cell) - 1));
      const targetWidthText = `${targetWidth}px`;
      if (tooltipCell.style.width !== targetWidthText) {
        tooltipCell.style.width = targetWidthText;
      }
    });
  });
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

    if (!persist && targetCol.dataset.wsOrigWidth === undefined) {
      targetCol.dataset.wsOrigWidth = targetCol.getAttribute('width') ?? '';
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

  syncTooltipCellWidths(table);

  if (persist) {
    const storedWidths = readStoredColumnWidths(table);
    storedWidths[String(columnIndex)] = safeWidth;
    writeStoredColumnWidths(table, storedWidths);
  }
}

function restoreOriginalAutoFitWidths(table: HTMLElement) {
  if (table.dataset.wsAutoFitApplied !== 'true') {
    return;
  }

  table.querySelectorAll('table').forEach((innerTable) => {
    if (!(innerTable instanceof HTMLTableElement)) {
      return;
    }
    const cols = Array.from(innerTable.querySelectorAll('colgroup > col')).filter((col) => {
      return col instanceof HTMLElement && col.getAttribute('name') !== 'gutter';
    }) as HTMLElement[];

    cols.forEach((col) => {
      if (col.dataset.wsOrigWidth !== undefined) {
        if (col.dataset.wsOrigWidth) {
          col.setAttribute('width', col.dataset.wsOrigWidth);
        } else {
          col.removeAttribute('width');
        }
        delete col.dataset.wsOrigWidth;
      }
      col.style.width = '';
      col.style.minWidth = '';
      col.style.maxWidth = '';
    });
  });

  getLeafHeaderCells(table).forEach((th) => {
    th.style.width = '';
    th.style.minWidth = '';
    th.style.maxWidth = '';
  });

  table.querySelectorAll('.el-table__header, .el-table__body').forEach((innerTable) => {
    if (innerTable instanceof HTMLTableElement) {
      innerTable.style.width = '';
    }
  });

  table.querySelectorAll('.el-table__body-wrapper tbody td .cell.el-tooltip').forEach((node) => {
    if (node instanceof HTMLElement && node.dataset.wsOrigTooltipWidth !== undefined) {
      node.style.width = node.dataset.wsOrigTooltipWidth;
      delete node.dataset.wsOrigTooltipWidth;
    }
  });

  delete table.dataset.wsAutoFitApplied;
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
      const renderedWidth = Math.ceil(btn.getBoundingClientRect().width);
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      const isLink = btn.classList.contains('is-link') || btn.classList.contains('el-button--link');
      const fallbackWidth = measureBody(label) + (isLink ? 12 : 28);
      totalBtnWidth += renderedWidth > 0 ? Math.max(renderedWidth, fallbackWidth) : fallbackWidth;
      if (idx > 0) {
        totalBtnWidth += 6;
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
  // 单元格内还有一层 .cell（el-table 自带左右 padding），只算 td 的 padding
  // 会低估 24px 左右，导致"学生1""2026-11-22 15:38"这类内容刚好被截成省略号。
  const innerPadX = (node: HTMLElement | null | undefined) => {
    if (!node || typeof window === 'undefined') return 0;
    const style = window.getComputedStyle(node);
    return Math.ceil((parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0));
  };
  const headerPadX =
    (thStyle
      ? Math.ceil((parseFloat(thStyle.paddingLeft) || 14) + (parseFloat(thStyle.paddingRight) || 14))
      : 28) + innerPadX(firstTh.querySelector('.cell') as HTMLElement | null);

  const firstTd = sampleRows[0]?.querySelector('td.el-table__cell') as HTMLElement | null;
  const tdStyle = firstTd && typeof window !== 'undefined' ? window.getComputedStyle(firstTd) : null;
  const bodyFont = tdStyle ? `${tdStyle.fontWeight || '400'} ${tdStyle.fontSize || '13px'} ${tdStyle.fontFamily || 'sans-serif'}` : '400 13px sans-serif';
  const bodyPadX =
    (tdStyle
      ? Math.ceil((parseFloat(tdStyle.paddingLeft) || 14) + (parseFloat(tdStyle.paddingRight) || 14))
      : 28) + innerPadX(firstTd?.querySelector('.cell') as HTMLElement | null);

  const measureHeader = getTextMeasurer(headerFont);
  const measureBody = getTextMeasurer(bodyFont);

  const columnKinds: Array<'selection' | 'actions' | 'tag' | 'compact' | 'tooltip' | 'text'> = [];

  const neededWidths = headers.map((header, colIdx) => {
    if (header.role === 'selection') {
      columnKinds[colIdx] = 'selection';
      return 48;
    }

    const headerNeeded = Math.max(MIN_RESIZABLE_COLUMN_WIDTH, measureHeader(header.label) + headerPadX + 10);

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
      return Math.min(420, rawNeeded);
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

  // 内容总宽度已经超过可视区域：恢复原始列宽并交给横向滚动 + 顶部镜像滚动条 + sticky 操作列处理，
  // 不压窄文字、不留宽屏放大时残留的多余空白宽度。
  if (viewportWidth > 0 && sumNeeded > viewportWidth) {
    restoreOriginalAutoFitWidths(table);
    table.dataset.wsAutoFitSig = signature;
    return;
  }

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
  }

  const totalFinalWidth = finalWidths.reduce((sum, w) => sum + w, 0);
  table.dataset.wsAutoFitSig = signature;
  table.dataset.wsAutoFitApplied = 'true';

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
    const shell = table.closest('.ws-table-shell');
    if (shell instanceof HTMLElement) {
      updateScrollCoveredState(table, shell);
    }
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function bindLeftResizeHandles(table: HTMLElement) {
  const headerCells = getLeafHeaderCells(table);
  if (headerCells.length <= 1) {
    return;
  }

  const existingHandles = table.querySelectorAll('.ws-col-left-resizer');
  if (existingHandles.length === headerCells.length - 1) {
    return;
  }

  existingHandles.forEach((node) => node.parentNode?.removeChild(node));

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

  autoFitTableColumns(table, headers);
  applyStoredColumnWidths(table);
  syncTooltipCellWidths(table);
  bindLeftResizeHandles(table);
  syncStickyActionColumn(table, headers);

  if (shell) {
    shell.dataset.tableColumns = String(headers.length);
    shell.dataset.hasActions = headers.some((item) => item.role === 'actions') ? 'true' : 'false';
    bindManagedTableScrollState(table, shell);
  }
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
