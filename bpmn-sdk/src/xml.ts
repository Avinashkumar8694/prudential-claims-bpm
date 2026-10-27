// Minimal, dependency-free XML parser + helpers tuned for jBPM BPMN 2.0.

export interface ElementNode {
  name: string;
  attrs: Record<string, string>;
  children: ElementNode[];
  text: string;
  cdata: string[];
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function parseXml(str: string): ElementNode {
  let i = 0;
  const n = str.length;
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const skipWs = () => { while (i < n && isWs(str[i])) i++; };

  function parseAttrs(s: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) { attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]); }
    return attrs;
  }

  function parseNode(): ElementNode {
    i++; // skip <
    let name = '';
    while (i < n && !isWs(str[i]) && str[i] !== '>' && str[i] !== '/') name += str[i++];
    let attrStr = '';
    while (i < n && str[i] !== '>' && !(str[i] === '/' && str[i + 1] === '>')) attrStr += str[i++];
    const node: ElementNode = { name, attrs: parseAttrs(attrStr), children: [], text: '', cdata: [] };
    if (str[i] === '/' && str[i + 1] === '>') { i += 2; return node; }
    i++; // skip >
    while (i < n) {
      if (str.startsWith('<!--', i)) { i = str.indexOf('-->', i) + 3; continue; }
      if (str.startsWith('<![CDATA[', i)) {
        const end = str.indexOf(']]>', i);
        node.cdata.push(str.slice(i + 9, end));
        node.text += str.slice(i + 9, end);
        i = end + 3; continue;
      }
      if (str.startsWith('</', i)) { i = str.indexOf('>', i) + 1; return node; }
      if (str[i] === '<') { node.children.push(parseNode()); continue; }
      let t = '';
      while (i < n && str[i] !== '<') t += str[i++];
      if (t.trim()) node.text += decodeEntities(t.trim());
    }
    return node;
  }

  while (i < n) {
    skipWs();
    if (str.startsWith('<?', i)) { i = str.indexOf('?>', i) + 2; continue; }
    if (str.startsWith('<!--', i)) { i = str.indexOf('-->', i) + 3; continue; }
    if (str.startsWith('<!', i)) { i = str.indexOf('>', i) + 1; continue; }
    if (str[i] === '<') break;
    i++;
  }
  return parseNode();
}

export function local(name: string): string { return name.includes(':') ? name.split(':')[1] : name; }
export function kids(node: ElementNode, localName: string): ElementNode[] {
  return (node.children || []).filter((c) => local(c.name) === localName);
}
export function kid(node: ElementNode, localName: string): ElementNode | undefined { return kids(node, localName)[0]; }
export function descendants(node: ElementNode, localName: string, out: ElementNode[] = []): ElementNode[] {
  for (const c of node.children || []) {
    if (local(c.name) === localName) out.push(c);
    descendants(c, localName, out);
  }
  return out;
}
export function cdataText(node?: ElementNode): string {
  return node ? (node.cdata.length ? node.cdata.join('') : node.text) : '';
}

export function escXml(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escAttr(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function cdata(s: unknown): string { return `<![CDATA[${s == null ? '' : s}]]>`; }

export function stringifyNode(el: ElementNode): string {
  const a = Object.entries(el.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  let inner: string;
  if (el.children && el.children.length) inner = el.children.map(stringifyNode).join('');
  else if (el.cdata && el.cdata.length) inner = el.cdata.map(cdata).join('');
  else inner = escXml(el.text || '');
  return inner ? `<${el.name}${a}>${inner}</${el.name}>` : `<${el.name}${a}/>`;
}
