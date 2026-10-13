const THREAD_WINDOW_SELECTOR = "[data-thread-window]";
const MATCH_HIGHLIGHT_NAME = "bb-chat-find-match";
const ACTIVE_HIGHLIGHT_NAME = "bb-chat-find-active";
const MAX_MATCHES = 1000;
const REFRESH_THROTTLE_MS = 150;
const BAR_WIDTH = 288;
const BAR_MIN_WIDTH = 180;
const BAR_INSET = 12;
const BAR_TOP_OFFSET = 8;

const OPEN_MODAL_SELECTOR = [
  '[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])',
  '[role="dialog"][data-state="open"]:not([inert]):not([inert] *)',
].join(", ");

const KEYBOARD_OWNER_SELECTOR =
  "[data-app-terminal], [data-app-browser], .monaco-editor";

const SKIPPED_SUBTREE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "script",
  "style",
  "noscript",
  "template",
  '[contenteditable="true"]',
  '[aria-hidden="true"]',
  ".sr-only",
  "[data-scroll-footer]",
  "[data-scroll-overlay]",
  "[data-app-composer]",
].join(", ");

const SCROLLABLE_OVERFLOW = /^(?:auto|scroll|overlay)$/u;

const INLINE_TAGS: Record<string, true> = {
  A: true,
  ABBR: true,
  B: true,
  BDI: true,
  BDO: true,
  CITE: true,
  CODE: true,
  DATA: true,
  DEL: true,
  DFN: true,
  EM: true,
  I: true,
  INS: true,
  KBD: true,
  LABEL: true,
  MARK: true,
  Q: true,
  S: true,
  SAMP: true,
  SMALL: true,
  SPAN: true,
  STRONG: true,
  SUB: true,
  SUP: true,
  TIME: true,
  U: true,
  VAR: true,
};

const STYLE = `
::highlight(${MATCH_HIGHLIGHT_NAME}) {
  background-color: color-mix(in oklab, var(--attention) 40%, transparent);
}
::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
  background-color: color-mix(in oklab, var(--warning) 75%, transparent);
  color: var(--ink);
}
.bb-chat-find {
  position: fixed;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 8px 24px -6px color-mix(in oklab, var(--ink) 22%, transparent);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 20px;
}
.bb-chat-find[hidden] {
  display: none;
}
.bb-chat-find__field {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 28px;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--background) 70%, transparent);
}
.bb-chat-find__input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--foreground);
  font: inherit;
}
.bb-chat-find__input::placeholder {
  color: var(--muted-foreground);
}
.bb-chat-find__count {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.bb-chat-find__count[data-empty="true"] {
  color: var(--destructive);
}
.bb-chat-find__button {
  display: flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.bb-chat-find__button:hover:not(:disabled) {
  background: var(--state-hover);
  color: var(--foreground);
}
.bb-chat-find__button:focus-visible {
  outline: 1px solid var(--ring);
}
.bb-chat-find__button:disabled {
  opacity: 0.4;
  cursor: default;
}
.bb-chat-find__button svg {
  width: 16px;
  height: 16px;
}
`;

const ICON_PATHS = {
  previous: ["m18 15-6-6-6 6"],
  next: ["m6 9 6 6 6-6"],
  close: ["M18 6 6 18", "m6 6 12 12"],
};

interface TextSegment {
  node: Text;
  start: number;
}

export interface ChatFindController {
  dispose(): void;
  openFromCommand(): void;
}

function blockAncestor(
  node: Text,
  root: Element,
  cache: Map<Element, Element>,
): Element {
  const parent = node.parentElement ?? root;
  const cached = cache.get(parent);
  if (cached !== undefined) return cached;
  let element = parent;
  while (element !== root && INLINE_TAGS[element.tagName] === true) {
    const next = element.parentElement;
    if (next === null) break;
    element = next;
  }
  cache.set(parent, element);
  return element;
}

function collectTextSegments(root: Element): {
  segments: TextSegment[];
  text: string;
} {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        const element = node as Element;
        if (element.matches(SKIPPED_SUBTREE_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return element.tagName === "BR"
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  const blocks = new Map<Element, Element>();
  const segments: TextSegment[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      text += "\n";
      continue;
    }
    const textNode = node as Text;
    if (textNode.data.length === 0) continue;
    const block = blockAncestor(textNode, root, blocks);
    if (previousBlock !== null && block !== previousBlock) text += "\n";
    previousBlock = block;
    segments.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { segments, text };
}

function segmentIndexAt(
  segments: readonly TextSegment[],
  offset: number,
  inclusiveEnd: boolean,
): number {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const start = segments[middle]!.start;
    if (inclusiveEnd ? start < offset : start <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function isRendered(node: Text, visibility: Map<Element, boolean>): boolean {
  const parent = node.parentElement;
  if (parent === null) return false;
  const cached = visibility.get(parent);
  if (cached !== undefined) return cached;
  const rendered =
    typeof parent.checkVisibility === "function"
      ? parent.checkVisibility({ visibilityProperty: true })
      : true;
  visibility.set(parent, rendered);
  return rendered;
}

function findTextRanges(root: Element, query: string): Range[] {
  if (query.length === 0) return [];
  const { segments, text } = collectTextSegments(root);
  if (segments.length === 0) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    "giu",
  );
  const visibility = new Map<Element, boolean>();
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    const startSegment = segments[segmentIndexAt(segments, start, false)]!;
    const endSegment = segments[segmentIndexAt(segments, end, true)]!;
    if (
      !isRendered(startSegment.node, visibility) ||
      !isRendered(endSegment.node, visibility)
    ) {
      continue;
    }
    const range = document.createRange();
    range.setStart(startSegment.node, start - startSegment.start);
    range.setEnd(endSegment.node, end - endSegment.start);
    ranges.push(range);
    if (ranges.length >= MAX_MATCHES) break;
  }
  return ranges;
}

function nearestRangeIndex(
  ranges: readonly Range[],
  previous: Range | null,
  fallbackIndex: number,
): number {
  if (ranges.length === 0) return -1;
  if (previous !== null && previous.startContainer.isConnected) {
    const index = ranges.findIndex(
      (range) =>
        range.compareBoundaryPoints(Range.START_TO_START, previous) >= 0,
    );
    return index === -1 ? ranges.length - 1 : index;
  }
  return Math.min(Math.max(fallbackIndex, 0), ranges.length - 1);
}

function revealRange(range: Range, obstruction: DOMRect | null): void {
  for (
    let element = range.startContainer.parentElement;
    element !== null;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    const scrollsX =
      SCROLLABLE_OVERFLOW.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth;
    const scrollsY =
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight;
    if (!scrollsX && !scrollsY) continue;
    const box = element.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    if (scrollsX && (rect.left < box.left || rect.right > box.right)) {
      element.scrollLeft += rect.left - box.left - (box.width - rect.width) / 2;
    }
    if (scrollsY) {
      const obstructed =
        obstruction !== null &&
        obstruction.left < box.right &&
        obstruction.right > box.left &&
        obstruction.bottom > box.top;
      const footer = element.querySelector("[data-scroll-footer]");
      const visibleTop = obstructed
        ? Math.max(box.top, obstruction.bottom)
        : box.top;
      const visibleBottom = Math.min(
        box.bottom,
        footer !== null ? footer.getBoundingClientRect().top : box.bottom,
      );
      if (rect.top < visibleTop || rect.bottom > visibleBottom) {
        element.scrollTop +=
          rect.top - visibleTop - (visibleBottom - visibleTop - rect.height) / 2;
      }
    }
  }
  const rect = range.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    window.scrollBy({ top: rect.top - (window.innerHeight - rect.height) / 2 });
  }
}

function isShownWindow(element: Element | null): element is Element {
  return (
    element !== null &&
    element.isConnected &&
    element.closest('[aria-hidden="true"], [inert]') === null &&
    (typeof element.checkVisibility !== "function" ||
      element.checkVisibility())
  );
}

function primaryWindow(): Element | null {
  const windows = Array.from(
    document.querySelectorAll(THREAD_WINDOW_SELECTOR),
  ).filter(isShownWindow);
  const inFocusedPane = windows.filter(
    (element) =>
      element.closest('[data-split-pane-id][data-focused="true"]') !== null,
  );
  const pool = inFocusedPane.length > 0 ? inFocusedPane : windows;
  return (
    pool.find((element) => !element.hasAttribute("data-surface-tone")) ??
    pool[0] ??
    null
  );
}

function iconButton(label: string, paths: readonly string[]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bb-chat-find__button";
  button.setAttribute("aria-label", label);
  button.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  button.append(svg);
  return button;
}

export function mountChatFind(): ChatFindController {
  const isMac = /Mac|iPhone|iPad|iPod/u.test(navigator.platform);
  const shortcutLabel = isMac ? "⌘F" : "Ctrl+F";
  const highlightsSupported =
    typeof Highlight !== "undefined" &&
    typeof CSS !== "undefined" &&
    "highlights" in CSS;
  const matchHighlight = highlightsSupported ? new Highlight() : null;
  const activeHighlight = highlightsSupported ? new Highlight() : null;
  if (matchHighlight !== null && activeHighlight !== null) {
    activeHighlight.priority = 1;
    CSS.highlights.set(MATCH_HIGHLIGHT_NAME, matchHighlight);
    CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, activeHighlight);
  }

  const style = document.createElement("style");
  style.dataset.bbChatFind = "";
  style.textContent = STYLE;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.className = "bb-chat-find";
  bar.hidden = true;
  bar.setAttribute("role", "search");
  bar.setAttribute("aria-label", "Find in chat");
  const field = document.createElement("div");
  field.className = "bb-chat-find__field";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "bb-chat-find__input";
  input.placeholder = "Find in chat";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", `Find in chat (${shortcutLabel})`);
  const count = document.createElement("span");
  count.className = "bb-chat-find__count";
  count.setAttribute("aria-live", "polite");
  field.append(input, count);
  const previousButton = iconButton("Previous match", ICON_PATHS.previous);
  const nextButton = iconButton("Next match", ICON_PATHS.next);
  const closeButton = iconButton("Close find bar", ICON_PATHS.close);
  bar.append(field, previousButton, nextButton, closeButton);
  document.body.append(bar);

  let currentWindow: Element | null = null;
  let lastPointerWindow: Element | null = null;
  let observer: MutationObserver | null = null;
  let ranges: Range[] = [];
  let activeIndex = -1;
  let restoreFocus: HTMLElement | null = null;
  let refreshTimer: number | undefined;
  let frame: number | undefined;
  let placed = { left: Number.NaN, top: Number.NaN, width: Number.NaN };

  const paint = () => {
    matchHighlight?.clear();
    activeHighlight?.clear();
    for (const range of ranges) matchHighlight?.add(range);
    const active = ranges[activeIndex];
    if (active !== undefined) activeHighlight?.add(active);
    const hasQuery = input.value.length > 0;
    count.dataset.empty = String(hasQuery && ranges.length === 0);
    count.textContent = !hasQuery
      ? ""
      : ranges.length === 0
        ? "No results"
        : `${activeIndex + 1}/${ranges.length}${ranges.length >= MAX_MATCHES ? "+" : ""}`;
    previousButton.disabled = ranges.length === 0;
    nextButton.disabled = ranges.length === 0;
  };

  const reveal = () => {
    const active = ranges[activeIndex];
    if (active !== undefined) revealRange(active, bar.getBoundingClientRect());
  };

  const search = (mode: "viewport" | "preserve") => {
    const previous = ranges[activeIndex] ?? null;
    ranges =
      currentWindow === null ? [] : findTextRanges(currentWindow, input.value);
    if (mode === "viewport") {
      const viewportTop = bar.getBoundingClientRect().bottom;
      const below = ranges.findIndex(
        (range) => range.getBoundingClientRect().top >= viewportTop,
      );
      activeIndex = below === -1 ? ranges.length - 1 : below;
    } else {
      activeIndex = nearestRangeIndex(ranges, previous, activeIndex);
    }
    paint();
    if (mode === "viewport") reveal();
  };

  const step = (delta: number) => {
    if (ranges.length === 0) return;
    activeIndex = (activeIndex + delta + ranges.length) % ranges.length;
    paint();
    reveal();
  };

  const place = () => {
    if (currentWindow === null) return;
    const anchor = currentWindow.querySelector(".thread-scrollbar") ?? currentWindow;
    const rect = anchor.getBoundingClientRect();
    bar.style.visibility = rect.width > 0 && rect.height > 0 ? "" : "hidden";
    const width = Math.max(
      BAR_MIN_WIDTH,
      Math.min(BAR_WIDTH, rect.width - BAR_INSET * 2),
    );
    const left = Math.round(rect.right - width - BAR_INSET);
    const top = Math.round(
      Math.min(
        Math.max(rect.top + BAR_TOP_OFFSET, BAR_TOP_OFFSET),
        window.innerHeight - 48,
      ),
    );
    if (left !== placed.left || top !== placed.top || width !== placed.width) {
      placed = { left, top, width };
      bar.style.left = `${left}px`;
      bar.style.top = `${top}px`;
      bar.style.width = `${width}px`;
    }
  };

  const close = () => {
    if (bar.hidden) return;
    bar.hidden = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    observer?.disconnect();
    observer = null;
    currentWindow = null;
    ranges = [];
    activeIndex = -1;
    matchHighlight?.clear();
    activeHighlight?.clear();
    const target = restoreFocus;
    restoreFocus = null;
    if (bar.contains(document.activeElement)) {
      if (target?.isConnected) {
        target.focus({ preventScroll: true });
      } else {
        input.blur();
      }
    }
  };

  const track = () => {
    frame = requestAnimationFrame(track);
    if (currentWindow === null || !currentWindow.isConnected) {
      close();
      return;
    }
    place();
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== undefined || input.value.length === 0) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      search("preserve");
    }, REFRESH_THROTTLE_MS);
  };

  const open = (target: Element) => {
    if (bar.hidden) {
      const active = document.activeElement;
      restoreFocus =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      bar.hidden = false;
      frame = requestAnimationFrame(track);
    }
    if (currentWindow !== target) {
      observer?.disconnect();
      currentWindow = target;
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(target, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
    place();
    input.focus({ preventScroll: true });
    input.select();
    search("viewport");
  };

  const resolveWindow = (target: Element | null): Element | null => {
    if (target !== null && bar.contains(target)) return currentWindow;
    if (
      target !== null &&
      target !== document.body &&
      target !== document.documentElement
    ) {
      const targetWindow = target.closest(THREAD_WINDOW_SELECTOR);
      if (targetWindow !== null) return targetWindow;
    } else if (isShownWindow(lastPointerWindow)) {
      return lastPointerWindow;
    }
    return primaryWindow();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    const modifier = isMac
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    const isF =
      event.key.toLowerCase() === "f" ||
      (!/^[a-z]$/iu.test(event.key) && event.code === "KeyF");
    if (!modifier || !isF) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(KEYBOARD_OWNER_SELECTOR) ||
      document.querySelector(OPEN_MODAL_SELECTOR) !== null
    ) {
      return;
    }
    const chatWindow = resolveWindow(target);
    if (chatWindow === null) return;
    event.preventDefault();
    event.stopPropagation();
    open(chatWindow);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || bar.contains(event.target)) return;
    lastPointerWindow = event.target.closest(THREAD_WINDOW_SELECTOR);
  };

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const onInput = () => search("viewport");
  const onPrevious = () => step(-1);
  const onNext = () => step(1);

  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);
  input.addEventListener("keydown", onInputKeyDown);
  input.addEventListener("input", onInput);
  previousButton.addEventListener("click", onPrevious);
  nextButton.addEventListener("click", onNext);
  closeButton.addEventListener("click", close);

  let disposed = false;
  return {
    openFromCommand() {
      if (disposed) return;
      const chatWindow = resolveWindow(
        document.activeElement instanceof Element
          ? document.activeElement
          : null,
      );
      if (chatWindow !== null) open(chatWindow);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      bar.remove();
      style.remove();
      if (CSS.highlights?.get(MATCH_HIGHLIGHT_NAME) === matchHighlight) {
        CSS.highlights.delete(MATCH_HIGHLIGHT_NAME);
      }
      if (CSS.highlights?.get(ACTIVE_HIGHLIGHT_NAME) === activeHighlight) {
        CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
      }
      lastPointerWindow = null;
    },
  };
}
