/**
 * Turn an Atlassian Document Format (ADF) comment body into plain text.
 *
 * Jira REST API v3 returns comment bodies as ADF (a JSON tree). The promise
 * extractor works on plain sentences, so we flatten the tree: text nodes are
 * concatenated, mentions become "@Name", and block nodes (paragraphs, list
 * items, headings) end with a newline so sentences never run together.
 */
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'panel']);

export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node; // REST v2 bodies are plain strings
  if (Array.isArray(node)) return node.map(adfToText).join('');

  switch (node.type) {
    case 'text':
      return node.text || '';
    case 'hardBreak':
      return '\n';
    case 'mention':
      return node.attrs?.text || '@someone';
    case 'emoji':
      return node.attrs?.text || '';
    case 'date': {
      // Date nodes store a UTC midnight timestamp in ms.
      const ts = Number(node.attrs?.timestamp);
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
    }
    case 'inlineCard':
      return node.attrs?.url || '';
    default: {
      const inner = adfToText(node.content || []);
      return BLOCK_TYPES.has(node.type) ? `${inner.trim()}\n` : inner;
    }
  }
}
