/**
 * Minimal DOM helper. h('div', { className: 'foo' }, child1, child2).
 * Children may be Node, string, number, false/null/undefined (skipped), or arrays.
 */

type Attrs = Record<string, unknown> & {
	className?: string;
	style?: Partial<CSSStyleDeclaration> | string;
	dataset?: Record<string, string>;
	on?: Record<string, EventListener>;
};

type Child = Node | string | number | boolean | null | undefined | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs?: Attrs | null,
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (attrs) {
		applyAttrs(el, attrs);
	}
	appendChildren(el, children);
	return el;
}

function applyAttrs(el: HTMLElement, attrs: Attrs): void {
	for (const key of Object.keys(attrs)) {
		const value = attrs[key];
		if (value === undefined || value === null || value === false) {
			continue;
		}
		if (key === 'className') {
			el.className = String(value);
		} else if (key === 'style') {
			if (typeof value === 'string') {
				el.setAttribute('style', value);
			} else {
				Object.assign(el.style, value);
			}
		} else if (key === 'dataset') {
			for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
				el.dataset[dk] = dv;
			}
		} else if (key === 'on') {
			for (const [evt, handler] of Object.entries(value as Record<string, EventListener>)) {
				el.addEventListener(evt, handler);
			}
		} else if (key.startsWith('aria-') || key.startsWith('data-')) {
			el.setAttribute(key, String(value));
		} else if (key in el) {
			(el as unknown as Record<string, unknown>)[key] = value;
		} else {
			el.setAttribute(key, String(value));
		}
	}
}

function appendChildren(el: HTMLElement, children: Child[]): void {
	for (const child of children) {
		if (child === null || child === undefined || child === false || child === true) {
			continue;
		}
		if (Array.isArray(child)) {
			appendChildren(el, child);
		} else if (child instanceof Node) {
			el.appendChild(child);
		} else {
			el.appendChild(document.createTextNode(String(child)));
		}
	}
}

export function clear(el: HTMLElement): void {
	while (el.firstChild) {
		el.removeChild(el.firstChild);
	}
}
