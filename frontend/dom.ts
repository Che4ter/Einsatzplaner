// dom.ts — type-safe getElementById wrappers.
// Reduces boilerplate; controllers and app.ts import from here instead of
// calling document.getElementById directly.

export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function on<K extends keyof HTMLElementEventMap>(
  id: string,
  type: K,
  handler: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
): void {
  const elem = el(id);
  if (elem) elem.addEventListener(type, handler as EventListener);
}

export function setText(id: string, text: string): void {
  const elem = el(id);
  if (elem) elem.textContent = text;
}

export function setHtml(id: string, html: string): void {
  const elem = el(id);
  if (elem) elem.innerHTML = html;
}

export function val(id: string): string {
  const elem = el<HTMLInputElement>(id);
  return elem ? elem.value : '';
}

export function show(id: string): void {
  const elem = el(id);
  if (elem) elem.style.display = '';
}

export function hide(id: string): void {
  const elem = el(id);
  if (elem) elem.style.display = 'none';
}
