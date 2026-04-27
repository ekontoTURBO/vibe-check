import { h } from './dom';
import { send } from './api';

/**
 * Renders a prompt or explanation string, turning every `` `code` `` span
 * into a clickable pill that asks the host to reveal that snippet in the
 * editor. Plain text segments stay as-is.
 *
 * Markdown-style inline code only: single-backtick pairs.
 */
export function renderPromptText(text: string, sourceFile?: string): Node[] {
	const out: Node[] = [];
	const regex = /`([^`\n]+)`/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		if (match.index > last) {
			out.push(document.createTextNode(text.slice(last, match.index)));
		}
		const snippet = match[1];
		out.push(codeRef(snippet, sourceFile));
		last = match.index + match[0].length;
	}
	if (last < text.length) {
		out.push(document.createTextNode(text.slice(last)));
	}
	return out;
}

function codeRef(snippet: string, sourceFile?: string): HTMLElement {
	return h(
		'button',
		{
			className: 'vc-code-ref',
			title: 'Reveal in editor',
			'aria-label': `Reveal ${snippet} in editor`,
			on: {
				click: (ev: Event) => {
					ev.stopPropagation();
					send({ type: 'revealSnippet', snippet, file: sourceFile });
				},
			},
		},
		snippet
	);
}
