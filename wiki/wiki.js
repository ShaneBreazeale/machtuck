// machtuck wiki: Markdown pages (pages/*.md, ordered by pages.json) rendered in the browser. No build step, like the sim.
// Routes: #/slug and #/slug/heading-id. Links between pages are written as `other-page.md` (or `other-page.md#id`) so
// the same files read correctly on GitHub; they are rewritten to routes here.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*~]/g, '').replace(/&[a-z]+;/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

// ---- inline: code, images, links, bold, italic, strikethrough, autolinks ----
function href(u) {
  if (/^\s*(javascript|data|vbscript):/i.test(u)) return { url: '#' };   // pages come from the repo, but never run script from a link
  if (/^[a-z][\w+.-]*:/i.test(u) || u.startsWith('//')) return { url: u, ext: true };
  const m = u.match(/^([\w-]+)\.md(?:#(.*))?$/);
  if (m) return { url: `#/${m[1]}${m[2] ? '/' + m[2] : ''}` };
  if (u.startsWith('#')) return { url: `#/${CUR}/${u.slice(1)}` };
  return { url: u };                                  // a file relative to wiki/ (images, ../ links into the repo)
}
function inline(s) {
  const code = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, u) => `<img src="${href(u).url}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => { const h = href(u.replace(/&amp;/g, '&')); return `<a href="${h.url}"${h.ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`; });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(code[+i])}</code>`);
}

// ---- blocks ----
export function render(md) {
  const lines = md.replace(/\r/g, '').split('\n'), out = [], toc = [];
  let i = 0;
  const isTable = (j) => /^\s*\|.*\|\s*$/.test(lines[j] || '') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[j + 1] || '');
  const cells = (l) => {           // split a table row on |, but not on \| or inside `code`
    const t = l.trim().replace(/^\|/, '').replace(/\|$/, ''), out = []; let cur = '', code = false;
    for (let k = 0; k < t.length; k++) {
      const ch = t[k];
      if (ch === '\\' && t[k + 1] === '|') { cur += '|'; k++; continue; }
      if (ch === '`') code = !code;
      if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim()); return out;
  };
  const blockStart = (l, j) => /^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|---+\s*$|\*\*\*+\s*$)/.test(l) || isTable(j);
  function list(base) {          // a list at indent `base`; items may contain nested lists and continuation lines
    const ordered = /^\s*\d+[.)]\s/.test(lines[i]), tag = ordered ? 'ol' : 'ul', start = ordered ? parseInt(lines[i].trim(), 10) : 1;
    let h = `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>`;
    while (i < lines.length) {
      const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m || m[1].length < base || m[1].length > base + 1 || /\d/.test(m[2]) !== ordered) break;
      i++;
      let text = m[3], sub = '';
      const task = text.match(/^\[([ xX])\]\s+(.*)$/);
      const fence = (l) => /^\s{2,}```/.test(l || '');
      while (i < lines.length && lines[i].trim() && !fence(lines[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) && /^\s{2,}/.test(lines[i])) text += ' ' + lines[i++].trim();
      while (i < lines.length) {
        const n = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s/);
        if (n && n[1].length > base + 1) { sub += list(n[1].length); continue; }
        if (fence(lines[i])) {        // a fenced code block inside the item, indented under it
          const ind = lines[i].match(/^\s*/)[0].length, lang = lines[i].trim().slice(3).trim(), buf = []; i++;
          while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++].slice(ind));
          i++; sub += `<pre><code${lang ? ` class="lang-${lang}"` : ''}>${esc(buf.join('\n'))}</code></pre>`; continue;
        }
        break;
      }
      const body = task ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}` : inline(text);
      h += `<li>${body}${sub}</li>`;
      if (i < lines.length && !lines[i].trim() && /^\s*([-*+]|\d+[.)])\s/.test(lines[i + 1] || '') && (lines[i + 1].match(/^\s*/)[0].length >= base)) i++;
    }
    return h + `</${tag}>`;
  }
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^```\s*([\w+-]*)/))) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${m[1] ? ` class="lang-${m[1]}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
    } else if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = m[1].length, html = inline(m[2]); let id = slugify(m[2]);
      while (toc.some((t) => t.id === id)) id += '-';
      toc.push({ n, id, text: html.replace(/<[^>]+>/g, '') });
      out.push(`<h${n} id="${id}">${html}${n > 1 ? `<a class="anchor" href="#/${CUR}/${id}" aria-label="Link to this section">#</a>` : ''}</h${n}>`);
      i++;
    } else if (/^(---+|\*\*\*+)\s*$/.test(l)) { out.push('<hr>'); i++; }
    else if (/^>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      const inner = render(buf.join('\n')).html, kind = (buf[0].match(/^\*\*(Note|Warning|Tip|Important):?\*\*/i) || [])[1];
      out.push(`<blockquote${kind ? ` class="callout ${kind.toLowerCase()}"` : ''}>${inner}</blockquote>`);
    } else if (isTable(i)) {
      const head = cells(lines[i]), al = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '')); i += 2;
      let h = '<div class="tbl"><table><thead><tr>' + head.map((c, k) => `<th${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      while (i < lines.length && /^\s*\|/.test(lines[i])) { h += '<tr>' + cells(lines[i]).map((c, k) => `<td${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      out.push(h + '</tbody></table></div>');
    } else if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s/))) out.push(list(m[1].length));
    else {
      const buf = [l.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i], i)) buf.push(lines[i++].trim());
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
  }
  return { html: out.join('\n'), toc };
}

// ---- the site ----
let CUR = 'home', NAV = [], FLAT = [];
const cache = new Map();
const $ = (s) => document.querySelector(s);
async function page(slug) {
  if (!cache.has(slug)) cache.set(slug, fetch(`pages/${slug}.md`, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  return cache.get(slug);
}
function sidebar() {
  $('#nav').innerHTML = NAV.map((s) => `<div class="sec"><div class="sh">${esc(s.section)}</div>${s.pages.map((p) => `<a href="#/${p.slug}" data-slug="${p.slug}">${esc(p.title)}</a>`).join('')}</div>`).join('');
}
async function show() {
  const [, slug = 'home', anchor] = decodeURIComponent(location.hash).match(/^#\/([\w-]+)?(?:\/(.+))?/) || [];
  CUR = FLAT.some((p) => p.slug === slug) ? slug : 'home';
  const md = await page(CUR), meta = FLAT.find((p) => p.slug === CUR);
  const { html, toc } = md ? render(md) : { html: `<h1>Not written yet</h1><p>This page is missing.</p>`, toc: [] };
  const k = FLAT.indexOf(meta), prev = FLAT[k - 1], next = FLAT[k + 1];
  $('#doc').innerHTML = html + `<nav class="pn">${prev ? `<a href="#/${prev.slug}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#/${next.slug}">${esc(next.title)} →</a>` : ''}</nav>`
    + `<p class="edit"><a href="https://github.com/ShaneBreazeale/machtuck/edit/main/wiki/pages/${CUR}.md" target="_blank" rel="noopener">Edit this page on GitHub</a></p>`;
  const sub = toc.filter((t) => t.n === 2 || t.n === 3);
  $('#toc').innerHTML = sub.length > 2 ? '<div class="sh">On this page</div>' + sub.map((t) => `<a class="l${t.n}" href="#/${CUR}/${t.id}">${esc(t.text)}</a>`).join('') : '';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.slug === CUR));
  document.title = `${meta ? meta.title : 'Wiki'} · machtuck wiki`;
  document.body.classList.remove('menu');
  const el = anchor && document.getElementById(anchor);
  if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
}

// ---- search: every page is fetched once, then matched line by line ----
let INDEX = null;
async function buildIndex() {
  if (INDEX) return INDEX;
  INDEX = await Promise.all(FLAT.map(async (p) => {
    const md = (await page(p.slug)) || '', secs = []; let cur = { id: '', title: p.title, text: '' };
    for (const l of md.split('\n')) {
      const h = l.match(/^#{2,4}\s+(.*)/);   // the H1 is the page itself
      if (h) { secs.push(cur); cur = { id: slugify(h[1]), title: h[1].replace(/[`*]/g, ''), text: '' }; } else cur.text += l + '\n';
    }
    secs.push(cur);
    return { ...p, secs };
  }));
  return INDEX;
}
async function search(q) {
  const box = $('#results'); q = q.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; return; }
  const words = q.split(/\s+/), hits = [];
  for (const p of await buildIndex()) for (const s of p.secs) {
    const hay = (s.title + ' ' + s.text).toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const score = (s.title.toLowerCase().includes(q) ? 40 : 0) + (hay.includes(q) ? 10 : 0)   // the whole phrase first
      + words.reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 5 : 0) + (p.title.toLowerCase().includes(w) ? 3 : 0) + Math.min(5, hay.split(w).length - 1), 0);
    const at = hay.indexOf(words[0], s.title.length), plain = (s.title + ' ' + s.text).replace(/[`*#|>\[\]]/g, ' ').replace(/\(([^)]*\.md[^)]*)\)/g, '').replace(/\s+/g, ' ');
    const snip = at > 0 ? plain.slice(Math.max(0, at - 60), at + 110) : plain.slice(0, 160);
    hits.push({ p, s, score, snip });
  }
  hits.sort((a, b) => b.score - a.score);
  const mark = (t) => { let h = esc(t); for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); return h; };
  box.innerHTML = hits.length ? hits.slice(0, 25).map((h) => `<a href="#/${h.p.slug}${h.s.id ? '/' + h.s.id : ''}"><b>${esc(h.p.title)}${h.s.id ? ' › ' + esc(h.s.title) : ''}</b><span>${mark(h.snip)}…</span></a>`).join('') : '<p class="none">No matches.</p>';
  box.hidden = false;
}

async function main() {
  NAV = await (await fetch('pages.json', { cache: 'no-cache' })).json();
  FLAT = NAV.flatMap((s) => s.pages);
  sidebar();
  window.addEventListener('hashchange', show);
  const q = $('#q');
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; search(''); q.blur(); } if (e.key === 'Enter') { const a = $('#results a'); if (a) { location.hash = a.getAttribute('href'); q.value = ''; search(''); } } });
  $('#results').addEventListener('click', (e) => { if (e.target.closest('a')) { q.value = ''; search(''); } });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
  $('#menu').addEventListener('click', () => document.body.classList.toggle('menu'));
  await show();
}
if (typeof document !== 'undefined') main();
