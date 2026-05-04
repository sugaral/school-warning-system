let cleanupFns: Array<() => void> = [];
const boundScrollableShells = new WeakSet<HTMLElement>();
const MIN_RESIZABLE_COLUMN_WIDTH = 72;

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

function applyColumnWidth(table: HTMLElement, columnIndex: number, width: number) {
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

  const storedWidths = readStoredColumnWidths(table);
  storedWidths[String(columnIndex)] = safeWidth;
  writeStoredColumnWidths(table, storedWidths);
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
