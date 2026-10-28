const $ = selector => document.querySelector(selector);
const main = $('#main');
const TABS = { overview: 'Overview', brand: 'Brand', setup: 'Setup & preferences' };
let state, selectedDraft, statusTimer, lastVideo;
const choices = new Map();
const tools = { checked: false, result: null, error: null };
const voice = { editing: false, confirmDisconnect: false, busy: false, error: null };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'className') node.className = value;
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const svgIcon = (d, extra = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d + extra; return s; };
const icons = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  drop: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 17v2.5h16V17"/>',
  done: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
};
function message(text, error = false) { const node = $('#status'); node.textContent = text; node.classList.add('visible'); node.setAttribute('role', error ? 'alert' : 'status'); clearTimeout(statusTimer); statusTimer = setTimeout(() => node.classList.remove('visible'), error ? 9000 : 3500); }
async function api(route) {
  const response = await fetch(route);
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
// The companion's only non-read requests (owner-approved): saving or removing the ElevenLabs key (it must not pass
// through the AI app's chat) and Show in Finder (opens a Finder window, changes nothing).
async function post(route, body) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
async function copy(text, done = 'Copied. Paste it into your AI app.') { try { await navigator.clipboard.writeText(text); message(done); } catch { message('Clipboard unavailable. Select and copy the text instead.', true); } }
const fullPath = relative => `${state.root}/${relative}`;
const revealButton = (relative, label = 'Show in Finder') => state.platform === 'darwin' && relative.startsWith('workspace/') && el('button', { className: 'ghost', title: fullPath(relative), onClick: async () => { try { await post('/api/reveal', { path: relative }); message('Opened in Finder.'); } catch (error) { message(`Could not open Finder: ${error.message}`, true); } } }, label);
const copyPathButton = (relative, label = 'Copy path') => el('button', { className: 'ghost', title: fullPath(relative), onClick: () => copy(fullPath(relative), 'Path copied. In Finder press ⇧⌘G and paste it.') }, label);
const sizeLabel = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const dateLabel = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const timeLabel = seconds => !Number.isFinite(seconds) ? '' : seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const stem = name => name.replace(/\.[^.]+$/, '');
const pad = n => String(n).padStart(2, '0');
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function mediaURL(path) { return `/media?path=${encodeURIComponent(path)}`; }
function head(title, lede) { return el('div', { className: 'page-head' }, el('h1', {}, title), lede && el('p', { className: 'lede' }, lede)); }
function fold(title, label, body, open = false) { return el('details', { className: 'fold', open }, el('summary', {}, el('h2', {}, title), label && el('span', { className: 'mono muted fold-label' }, label)), el('div', { className: 'fold-body' }, body)); }
function copyBlock(text, buttonLabel, note) {
  return el('div', { className: 'stack' }, el('div', { className: 'row' }, el('button', { className: 'primary', onClick: () => copy(text) }, buttonLabel), note && el('span', { className: 'muted' }, note)), el('details', {}, el('summary', { className: 'muted' }, 'Preview'), el('pre', { className: 'preview' }, text)));
}

const readRules = 'Follow AGENTS.md: read the files it lists first, reuse my saved preferences, ask only about missing decisions, and never overwrite originals or approved versions.';
const updateText = 'Update this video editing app to the latest version from GitHub with git pull. First run git status and tell me about any local changes; never discard, overwrite or move anything in workspace/ (my videos, preferences and assets). If the pull would conflict, stop and explain. Afterwards tell me in plain words what changed, and run npm --prefix system/app test.';
const studioText = 'Open the editor app (HyperFrames Studio) on my current video. Before you rebuild anything afterwards, back up what I changed there, carry my edits into your build script and tell me what you kept.';
const polishTemplate = project => `Turn my rough notes below into a precise editing brief for my AI video editor.\nKeep it surgical: for each change give the timestamp, what to change, what must stay exactly the same, and how to check it is right. Order by priority. Do not invent new ideas or redesign anything I did not mention. End with a short "Do not change" list.\nProject: ${project?.name || '<project>'}${project?.drafts.at(-1) ? `, current draft: ${project.drafts.at(-1).name}` : ''}.\n\nMy notes:\n[paste your notes here]`;
const closeNotesText = (project, draft) => `In ${project.folder}/feedback.md, the review notes up to and including ${draft ? stem(draft.name) : 'the current draft'} are settled: they are done and must not be carried forward or re-applied unless I mention them again. Add a short "## Settled up to ${draft ? stem(draft.name) : 'the current draft'}" section saying exactly that, then confirm which earlier notes you will no longer apply.`;
// feedback.md split into its "## " sections, newest first, each tagged with the draft it is about.
function feedbackSections(text) {
  const parts = text.replace(/\r/g, '').split(/^(?=## )/m).filter(p => p.startsWith('## '));
  return parts.map(p => { const [title, ...body] = p.split('\n'); const t = title.slice(3).trim(); return { title: t, body: body.join('\n').trim(), draft: /draft[\s-]*(\d+)/i.exec(t)?.[1] || (/^Approved version/i.test(t) ? /draft-(\d+)/i.exec(body.join('\n'))?.[1] : null) || null, approval: /^Approved version/i.test(t) || /^Draft \d+.*approved/i.test(t) }; }).reverse();
}
const factors = [
  { id: 'captions', title: 'Caption behavior', hint: 'Show a phrase, a spoken word, or no captions.', options: ['Short phrases', 'Highlight spoken words', 'No captions'], demo: () => el('div', { className: 'demo caption' }, el('span', {}, 'A ', el('span', { className: 'active-word' }, 'clear'), ' idea')), instructions: ['Display short phrases of spoken captions.', 'Display short phrases and highlight the currently spoken word in sync with speech.', 'Do not add spoken captions.'] },
  { id: 'placement', title: 'Caption placement', hint: 'Check the actual face, framing and platform controls.', options: ['Low on screen', 'Centered'], demo: () => el('div', { className: 'demo' }, el('span', { className: 'ghost' }), el('span', { className: 'low-caption' }, 'Room for the person')), instructions: ['Place captions low on the screen, not relative to the face; preserve platform clearance.', 'Place captions near screen center only where they do not cover important content or the face.'] },
  { id: 'readability', title: 'Text readability', hint: 'A caption treatment—not a filter on your footage.', options: ['Plain', 'Shadow', 'Outline', 'Background'], demo: () => el('div', { className: 'demo caption' }, 'Readable words'), instructions: ['Use plain caption text where readable.', 'Use a subtle caption text shadow for readability.', 'Use a caption text outline for readability.', 'Use a background behind caption text for readability.'] },
  { id: 'pacing', title: 'Pacing', hint: 'Preserve meaning and natural speech.', options: ['Keep pauses', 'Conservative tightening'], demo: () => el('div', { className: 'demo' }, el('div', { className: 'pacing' }, el('i'), el('i', { className: 'gap' }), el('i'), el('i', { className: 'gap' }), el('i'))), instructions: ['Keep source pauses and original pacing unless separately instructed.', 'Tighten clear pauses conservatively without removing uncertain speech or changing meaning.'] },
  { id: 'visuals', title: 'Supporting visuals', hint: 'Use only supplied, approved assets.', options: ['Footage only', 'Relevant supplied assets'], demo: () => el('div', { className: 'demo' }, 'Your footage', el('span', { className: 'inset' }, 'Asset')), instructions: ['Use original footage only, without added supporting visuals.', 'Use relevant supplied and permitted supporting assets only where they explain the current sentence; no invented or generated imagery.'] },
  { id: 'sound', title: 'Sound', hint: 'Keep the voice. Music and effects need approved files.', options: ['Voice only', 'Subtle permitted audio'], demo: () => el('div', { className: 'demo' }, el('div', { className: 'wave' }, ...Array.from({ length: 17 }, () => el('i')))), instructions: ['Preserve original voice only; no added music or effects.', 'Preserve original voice; use subtle music/effects only from explicitly approved, permitted local files. Ask if these are missing.'] }
];

// Minimal Markdown → DOM. Builds elements and text nodes only, so document content can never inject HTML.
function inline(text, parent) {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)<>]+)|(\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) parent.append(el('code', {}, t.slice(1, -1)));
    else if (m[2]) parent.append(el('strong', {}, t.slice(2, -2)));
    else if (m[3]) { const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t); parent.append(/^https?:\/\//.test(href) ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label) : label); }
    else if (m[4]) parent.append(el('a', { href: t, target: '_blank', rel: 'noopener noreferrer' }, t));
    else parent.append(el('em', {}, t.slice(1, -1)));
    last = re.lastIndex;
  }
  parent.append(text.slice(last));
  return parent;
}
function renderMarkdown(source) {
  const out = el('div', { className: 'doc' });
  const lines = source.replace(/\r/g, '').split('\n');
  let para = [];
  // These docs are line-oriented ("Field: value" per line), so line breaks are kept and a leading label is bolded.
  const flush = () => {
    if (!para.length) return;
    const p = el('p');
    para.forEach((line, i) => {
      if (i) p.append(el('br'));
      const label = /^([A-Z][^:]{0,60}):(\s|$)/.exec(line);
      if (label) { p.append(el('strong', {}, `${label[1]}:`)); inline(line.slice(label[1].length + 1), p); } else inline(line, p);
    });
    out.append(p); para = [];
  };
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) { flush(); const code = []; while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]); out.append(el('pre', {}, el('code', {}, code.join('\n')))); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.append(inline(h[2], el(`h${Math.min(h[1].length, 4)}`))); continue; }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flush(); const table = el('table'); const header = cells(line); i++;
      table.append(el('thead', {}, el('tr', {}, header.map(c => inline(c, el('th'))))));
      const body = el('tbody');
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) body.append(el('tr', {}, cells(lines[++i]).map(c => inline(c, el('td')))));
      table.append(body); out.append(el('div', { className: 'table-wrap' }, table)); continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flush(); const list = el(/\d/.test(li[1]) ? 'ol' : 'ul'); list.append(inline(li[2], el('li')));
      while (i + 1 < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) list.append(inline(/^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[++i])[1], el('li')));
      out.append(list); continue;
    }
    if (!line.trim()) flush(); else para.push(line.trim());
  }
  flush();
  return out;
}
function docView(file, note = 'Read-only. To change it, tell your AI app what to change.') {
  const box = el('div', {});
  let raw = false, content = '';
  const draw = () => {
    const toggle = el('button', { className: 'ghost', onClick: () => { raw = !raw; draw(); } }, raw ? 'View formatted' : 'View raw Markdown');
    box.replaceChildren(el('div', { className: 'doc-tools' }, el('span', { className: 'mono muted', title: fullPath(file) }, file), el('div', { className: 'row' }, toggle, copyPathButton(file), el('button', { className: 'ghost', onClick: load }, 'Reload'))),
      content ? (raw ? el('textarea', { className: 'raw', readOnly: true, value: content, 'aria-label': file }) : renderMarkdown(content)) : el('p', { className: 'muted' }, 'This file does not exist yet.'),
      el('p', { className: 'muted' }, note));
  };
  const load = async () => {
    box.replaceChildren(el('p', { className: 'muted' }, 'Reading…'));
    try { content = (await api(`/api/document?path=${encodeURIComponent(file)}`)).content; draw(); }
    catch (error) { box.replaceChildren(el('p', { className: 'error' }, `Could not read ${file}: ${error.message}`)); }
  };
  load();
  return box;
}
function docSwitcher(files) {
  const box = el('div', {}); let current = files[0];
  const tabs = el('div', { className: 'row', role: 'tablist' });
  const draw = () => {
    tabs.replaceChildren(...files.map(f => el('button', { className: f === current ? 'primary' : 'ghost', role: 'tab', 'aria-selected': String(f === current), onClick: () => { current = f; draw(); } }, stem(f.split('/').at(-1)))));
    box.replaceChildren(tabs, el('div', { style: 'margin-top:16px' }, docView(current)));
  };
  draw(); return box;
}

function newVideoPrompt(file) {
  return `${readRules}\nI put a new video in ${state.dropFolder}/: ${file.name}. Follow "When the user has a new video" in AGENTS.md: suggest the project (an existing one or a new one) and a video name and confirm them with me, move the file unchanged into workspace/projects/<project>/<video>/source/, then write plan.md ("this is what I have in mind") and open the plan page for me before you start. Do not overwrite existing videos. No publishing.`;
}
function sourceStatus(project) {
  if (!project.sourceExists) return 'No source folder';
  return project.source.length ? `${project.source.length} file${project.source.length === 1 ? '' : 's'}` : 'Empty';
}
// Routes (location.hash): overview | project/<p> | video/<p>/<v> | plan/<p>/<v> | brand | setup
let route = { name: 'overview' };
const openGroups = new Set();
function parseHash() {
  const [name, a, b] = location.hash.slice(1).split('/').map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  route = name === 'video' && a && b ? { name, project: a, video: b } : name === 'plan' && a && b ? { name, project: a, video: b } : name === 'project' && a ? { name, project: a } : name === 'brand' || name === 'setup' ? { name } : { name: 'overview' };
}
const goto = path => { const next = `#${path}`; if (location.hash === next) render(); else location.hash = next; };
const videoPath = (kind, v) => `${kind}/${encodeURIComponent(v.project)}/${encodeURIComponent(v.name)}`;
const openVideo = v => { selectedDraft = null; goto(videoPath('video', v)); };
const openPlan = v => goto(videoPath('plan', v));
const openProjectPage = g => goto(`project/${encodeURIComponent(g.name)}`);
const currentVideo = () => state.videos.find(v => v.project === route.project && v.name === route.video);
const currentGroup = () => state.projects.find(g => g.name === route.project);
const videoStatus = v => v.approved || finalsFor(v).length ? 'finished' : v.drafts.length ? 'review' : 'raw';

function folderRow(icon, name, relative, what, extra) {
  return el('div', { className: 'frow' }, svgIcon(icons[icon]), el('div', {}, el('span', { className: 'name' }, name), what && el('p', { className: 'what' }, what)), el('span', { className: 'where mono', title: fullPath(relative) }, `…/${relative}/`), el('div', { className: 'row' }, extra, revealButton(relative), copyPathButton(relative)));
}
// The newest numbered draft (draft-NN…, most recently written); calibration samples and other files don't count.
const latestDraft = project => { const numbered = project.drafts.filter(d => /^draft-\d+/i.test(d.name)); return (numbered.length ? numbered : project.drafts).slice().sort((a, b) => a.modified.localeCompare(b.modified)).at(-1); };
// "Dismiss" hides the not-approved reminder for one draft (kept in this browser only; a newer draft brings the reminder back).
const dismissedKey = () => `dismissed:${state.root}`;
function dismissedDrafts() { try { return JSON.parse(storageGet(dismissedKey()) || '{}'); } catch { return {}; } }
const isDismissed = (project, draft) => Boolean(draft) && dismissedDrafts()[project.name] === draft.path;
function dismissDraft(project, draft) { storageSet(dismissedKey(), JSON.stringify({ ...dismissedDrafts(), [project.name]: draft.path })); render(); }
const needsApproval = project => Boolean(latestDraft(project)) && latestDraft(project).path !== project.approved;
// Approve: really approves (the companion's third owner-approved write, 2026-10-28): the approval record in feedback.md,
// the finished copy and the poster. Two clicks, because it replaces that version's previous finished copy.
function approveControls(project, draft, { dismissible = false } = {}) {
  const finals = finalsFor(project), hasVariants = finals.some(f => f.version), isYoutube = /youtube/i.test(draft.name);
  const options = (hasVariants || isYoutube) ? Object.entries(VERSION_LABEL).filter(([id]) => id || !hasVariants) : [['', VERSION_LABEL['']]];
  const guess = isYoutube ? 'youtube' : finals.find(f => f.version && f.version !== 'youtube')?.version ?? '';
  const box = el('div', { className: 'approve' });
  let confirming = false, busy = false, version = options.some(([id]) => id === guess) ? guess : options[0][0];
  const target = () => `${project.name}${version ? `-${version}` : ''}.mp4`;
  const run = async () => {
    busy = true; draw();
    try { const result = await post('/api/approve', { project: project.project, video: project.name, draft: draft.path.slice(project.folder.length + 1), version }); message(`Approved. Copied to Finished videos as ${result.finished.split('/').at(-1)}.`); await reloadState(); }
    catch (error) { busy = false; confirming = false; draw(); message(`Could not approve: ${error.message}`, true); }
  };
  const draw = () => {
    const pick = options.length > 1 && el('label', { className: 'field inline' }, el('span', {}, 'This is the'), el('select', { onChange: e => { version = e.target.value; draw(); }, disabled: busy }, options.map(([id, label]) => el('option', { value: id, selected: id === version }, label))), el('span', {}, 'version'));
    box.replaceChildren(
      confirming ? el('div', { className: 'confirm' }, el('p', {}, el('strong', {}, `I watched all of ${draftTitle(draft.name)} with sound. `), `Approve it and copy it to Finished videos as ${target()}?`, finals.some(f => f.version === version) ? ' This replaces the current finished file of that version.' : ''),
          el('div', { className: 'row' }, el('button', { className: 'primary', disabled: busy, onClick: run }, busy ? 'Approving…' : 'Yes, approve'), el('button', { className: 'ghost', disabled: busy, onClick: () => { confirming = false; draw(); } }, 'Cancel')))
        : el('div', { className: 'row' }, pick, el('button', { className: 'primary', onClick: () => { confirming = true; draw(); } }, `Approve ${draftTitle(draft.name).split(' · ')[0]}`), dismissible && el('button', { className: 'ghost', title: 'Hide this reminder. It comes back if a newer draft appears.', onClick: () => dismissDraft(project, draft) }, 'Dismiss'),
          el('button', { className: 'ghost', title: 'Copy an instruction instead and paste it in your AI app', onClick: () => copy(approvalTextFor(project, draft)) }, 'Copy instruction instead')));
  };
  draw(); return box;
}
function sayRow(say, what, text) { return el('div', { className: 'say' }, el('div', {}, el('strong', {}, `“${say}”`), el('p', { className: 'muted' }, what)), text && el('button', { className: 'ghost', onClick: () => copy(text) }, 'Copy instruction')); }
// ---- Videos page: one row per video, found by name; grouped by what needs you ----
const VERSION_LABEL = { '': 'Final', vertical: 'Vertical 9:16', square: 'Square 1:1', youtube: 'YouTube 16:9' };
const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Finished files that belong to a video: <name>.mp4, <name>-vertical.mp4, <name>-square.mp4, <name>-youtube.mp4.
const finalSource = (project, f) => project?.drafts.find(d => d.bytes === f.bytes);
const finalsFor = video => state.finishedVideos.filter(f => f.project === video.project).map(f => { const m = new RegExp(`^${escapeRe(video.name)}(?:-(vertical|square|youtube))?$`).exec(stem(f.name)); return m ? { ...f, version: m[1] || '' } : null; }).filter(Boolean).sort((a, b) => Object.keys(VERSION_LABEL).indexOf(a.version) - Object.keys(VERSION_LABEL).indexOf(b.version));
// "draft-04-hard-cuts-ends-on-investors-hdr.mp4" -> "Draft 04 · Hard cuts ends on investors"
const draftTitle = name => { const m = /^draft-(\d+)[-_ ]?(.*)$/i.exec(stem(name)); if (!m) return stem(name); const words = m[2].replace(/-hdr$/i, '').replace(/[-_]+/g, ' ').trim(); return `Draft ${pad(Number(m[1]))}${words ? ` · ${words.charAt(0).toUpperCase()}${words.slice(1)}` : ''}`; };
const draftNumber = name => /^draft-(\d+)/i.exec(stem(name))?.[1];
function videoEntries() {
  const claimed = new Set();
  const entries = state.videos.map(project => {
    const finals = finalsFor(project); finals.forEach(f => claimed.add(f.path));
    const status = project.approved || finals.length ? 'finished' : project.drafts.length ? 'review' : 'raw';
    const touched = [...finals, ...project.drafts, ...project.source].map(f => f.modified).sort().at(-1) || '';
    return { name: project.name, project, finals, status, touched };
  });
  // finished files that match no project folder still get a row, so nothing is lost
  for (const f of state.finishedVideos.filter(f => !claimed.has(f.path))) entries.push({ name: stem(f.name), project: null, finals: [{ ...f, version: '' }], status: 'finished', touched: f.modified });
  return entries.sort((a, b) => b.touched.localeCompare(a.touched));
}
function videoRow(v) {
  const { project, finals } = v;
  const latest = project && latestDraft(project);
  const approvedDraftFile = project?.drafts.find(d => d.path === project.approved);
  const open = () => project && openVideo(project);
  const thumbSource = finals[0]?.path || approvedDraftFile?.path || latest?.path;
  const thumb = project?.poster ? el('img', { className: 'vthumb', src: mediaURL(project.poster), alt: '', loading: 'lazy', onClick: open }) : thumbSource ? el('video', { className: 'vthumb', muted: true, playsInline: true, preload: 'metadata', src: `${mediaURL(thumbSource)}#t=0.6`, 'aria-hidden': 'true', onClick: open }) : el('div', { className: 'vthumb empty' });
  const newer = project && v.status === 'finished' && latest && latest.path !== project.approved && !isDismissed(project, latest);
  const tag = v.status === 'finished' ? el('span', { className: 'tag ok' }, 'Finished') : v.status === 'review' ? el('span', { className: 'tag on' }, 'Waiting for your review') : el('span', { className: 'tag' }, 'Raw footage');
  const line = v.status === 'finished'
    ? `${finals.length > 1 ? `${finals.length} versions` : approvedDraftFile ? `Approved: ${draftTitle(approvedDraftFile.name)}` : 'Finished video'}${project?.approvedOn ? ` · last approved ${project.approvedOn}` : ''}`
    : v.status === 'review' ? `Latest: ${draftTitle(latest.name)} · ${dateLabel(latest.modified)}` : `${project.source.length ? `${project.source.length} source file${project.source.length === 1 ? '' : 's'}` : 'No source footage yet'} · no drafts yet`;
  const versions = finals.length ? el('div', { className: 'vers' }, finals.map(f => el('div', { className: 'ver' }, el('span', { className: 'vlabel' }, VERSION_LABEL[f.version]), el('span', { className: 'muted' }, `${sizeLabel(f.bytes)} · ${dateLabel(f.modified)}`), revealButton(f.path, 'Show in Finder')))) : null;
  const revealTarget = latest?.path || approvedDraftFile?.path;
  return el('article', { className: 'vrow' }, thumb,
    el('div', { className: 'vbody' },
      el('div', { className: 'row' }, project ? el('button', { className: 'vname', onClick: open }, v.name) : el('h2', {}, v.name), tag, newer && el('span', { className: 'tag warn' }, `Newer draft ${draftNumber(latest.name) || ''} not approved`.replace('  ', ' '))),
      el('p', { className: 'muted vline' }, line), versions),
    el('div', { className: 'vactions' }, project && el('button', { className: v.status === 'review' ? 'primary' : '', onClick: open }, v.status === 'review' ? 'Review drafts' : 'Open video'), revealTarget && revealButton(revealTarget, 'Show drafts in Finder')));
}
let videoQuery = '', videoFilter = 'all', listMode = storageGet('videoView') === 'cards' ? 'cards' : 'table', videoSort = { key: 'status', dir: 1 };
const STATUS_ORDER = { review: 0, finished: 1, raw: 2 };
const STATUS_LABEL = { review: 'Waiting for your review', finished: 'Finished', raw: 'Raw footage' };
const wsName = () => state.workspace?.name || null;
const nameWorkspaceText = 'Set up the name of this workspace: ask me what to call it (my brand or my client), save it in workspace/preferences/workspace.md and remind me that one brand or client = one copy of this folder.';
const cleanCopyText = name => `Make a clean copy of this workspace for <new brand or client name>: follow "Workspace identity" in AGENTS.md. Ask me where to put it, copy only the tools (system/) and an empty workspace, never touch or copy my videos here${name ? ` (this workspace is "${name}")` : ''}, and tell me how to open the new folder.`;
const copyReminder = 'One brand or client = one copy of this folder. Don’t mix brands in one folder: preferences, fonts, assets and finished videos would blend. For a new brand or client, make a copy of the original (in Finder, or ask your AI app for a clean copy) and set it up there.';
function statusTag(v, short = false) {
  const planned = v.status === 'raw' && v.project?.plan;
  return el('span', { className: `tag ${v.status === 'finished' ? 'ok' : v.status === 'review' || planned ? 'on' : ''}` }, planned ? 'Plan ready' : short && v.status === 'review' ? 'Needs review' : STATUS_LABEL[v.status]);
}
function nameWorkspaceCard() {
  return el('div', { className: 'nudge', role: 'note' },
    el('div', {}, el('strong', {}, 'Name this workspace.'), el('span', {}, ' It is not named yet. Ask your AI app: what is this workspace for, your brand or your client? '), el('span', {}, copyReminder)),
    el('button', { className: 'primary', onClick: () => copy(nameWorkspaceText) }, 'Copy instruction'));
}
function newFootageBanner() {
  if (!state.newVideos.length) return null;
  return el('div', { className: 'nudge', role: 'note' },
    el('div', {}, el('strong', {}, `${state.newVideos.length} new video${state.newVideos.length === 1 ? '' : 's'} waiting in the drop folder.`), el('span', {}, ` ${state.newVideos.map(f => `${f.name} (${sizeLabel(f.bytes)})`).join(', ')}. Your AI app will suggest a name and move it into its own project.`)),
    el('div', { className: 'row' }, state.newVideos.length === 1 ? el('button', { className: 'primary', onClick: () => copy(newVideoPrompt(state.newVideos[0])) }, 'Copy start instruction') : el('button', { className: 'primary', onClick: () => copy(`${readRules}\nI put new videos in ${state.dropFolder}/. Ask me which one to start with.`) }, 'Copy start instruction'), revealButton(state.dropFolder, 'Show drop folder')));
}
function summaryStrip(entries) {
  const count = status => entries.filter(v => v.status === status).length;
  const total = entries.reduce((sum, v) => sum + (v.project?.bytes || 0), 0);
  const last = entries.map(v => v.touched).sort().at(-1);
  const cell = (label, value, hint) => el('div', { className: 'sum' }, el('b', {}, value), el('span', { className: 'label' }, label), hint && el('span', { className: 'muted sum-hint' }, hint));
  return el('div', { className: 'summary' }, cell('Videos', String(entries.length)), cell('Waiting for review', String(count('review'))), cell('Finished', String(count('finished'))), cell('Raw footage', String(count('raw'))), cell('Last activity', dateLabel(last) || '—'), cell('On disk', total ? sizeLabel(total) : '—', 'all projects'));
}
const sortValue = { name: v => v.name.toLowerCase(), status: v => STATUS_ORDER[v.status], updated: v => v.touched, size: v => v.project?.bytes || 0 };
function sortEntries(list) {
  const { key, dir } = videoSort;
  return list.slice().sort((a, b) => { const x = sortValue[key](a), y = sortValue[key](b); const c = x < y ? -1 : x > y ? 1 : 0; return (c || b.touched.localeCompare(a.touched) || a.name.localeCompare(b.name)) * (c ? dir : 1) || 0; });
}
const VERSION_SHORT = { '': 'Final', vertical: 'Vertical', square: 'Square', youtube: 'YouTube' };
const shortDate = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };
function videoTable(shown, redraw) {
  const th = (key, label) => el('th', { 'aria-sort': videoSort.key === key ? (videoSort.dir === 1 ? 'ascending' : 'descending') : 'none' }, el('button', { className: 'thbtn', onClick: () => { videoSort = videoSort.key === key ? { key, dir: -videoSort.dir } : { key, dir: key === 'updated' || key === 'size' ? -1 : 1 }; redraw(); } }, label, videoSort.key === key ? (videoSort.dir === 1 ? ' ↑' : ' ↓') : ''));
  const body = sortEntries(shown).map(v => {
    const { project, finals } = v; const latest = project && latestDraft(project); const approvedFile = project?.drafts.find(d => d.path === project.approved);
    const open = () => project && openVideo(project);
    const newer = project && v.status === 'finished' && latest && latest.path !== project.approved && !isDismissed(project, latest);
    const draftCell = v.status === 'finished' ? (approvedFile ? `✓ ${draftTitle(approvedFile.name)}` : 'Finished video') : v.status === 'review' ? `${draftTitle(latest.name)} (not approved)` : 'No drafts yet';
    const target = finals[0]?.path || latest?.path;
    return el('tr', {},
      el('td', { className: 'tcell-thumb' }, project?.poster ? el('img', { className: 'tthumb', src: mediaURL(project.poster), alt: '', loading: 'lazy', onClick: open }) : el('div', { className: 'tthumb empty' })),
      el('td', {}, project ? el('button', { className: 'vname small', onClick: open }, v.name) : el('strong', {}, v.name), newer && el('div', {}, el('span', { className: 'tag warn' }, `Newer draft ${draftNumber(latest.name) || ''} not approved`.replace('  ', ' ')))),
      el('td', {}, statusTag(v, true)), el('td', { className: 'tdraft' }, draftCell),
      el('td', { className: 'muted' }, finals.length ? finals.map(f => VERSION_SHORT[f.version]).join(' · ') : '—'),
      el('td', { className: 'muted nowrap' }, project?.bytes ? sizeLabel(project.bytes) : '—'), el('td', { className: 'muted nowrap' }, shortDate(v.touched)),
      el('td', {}, el('div', { className: 'row' }, project && (v.status === 'raw' && project.plan ? el('button', { className: 'primary', onClick: () => openPlan(project) }, 'View plan') : el('button', { className: v.status === 'review' ? 'primary' : '', onClick: open }, v.status === 'review' ? 'Watch & approve' : 'Open')), target && revealButton(target, finals.length ? 'Show video' : 'Show draft'))));
  });
  return el('div', { className: 'table-wrap' }, el('table', { className: 'vtable' }, el('thead', {}, el('tr', {}, el('th', {}), th('name', 'Video'), th('status', 'Status'), el('th', {}, 'Draft'), el('th', {}, 'Formats'), th('size', 'Disk use'), th('updated', 'Updated'), el('th', {}))), el('tbody', {}, body)));
}
const newVideoInProjectText = group => `${readRules}\nI want a new video in the project "${group.title}" (workspace/projects/${group.name}/). Follow "When the user has a new video" in AGENTS.md: ask me for the footage if it is not in the drop folder, suggest a video name, write plan.md and open the plan page for me.`;
// Collapsed projects on the Overview are remembered in this browser.
const collapsedKey = () => `collapsed:${state.root}`;
function collapsedProjects() { try { return new Set(JSON.parse(storageGet(collapsedKey()) || '[]')); } catch { return new Set(); } }
function projectSection(group, list, redraw) {
  const key = group.name || '_other';
  let collapsed = collapsedProjects().has(key);
  const body = el('div', { className: 'pgroup-body' }, list.length ? (listMode === 'table' ? videoTable(list, redraw) : el('div', { className: 'vlist' }, list.map(videoRow))) : el('p', { className: 'muted', style: 'margin:0' }, 'No videos in this project yet.'));
  const toggle = el('button', { className: 'pgroup-toggle ghost', 'aria-expanded': String(!collapsed), 'aria-label': `${collapsed ? 'Show' : 'Hide'} the videos in ${group.title}`, title: 'Show or hide the videos' }, svgIcon('<path d="m9 6 6 6-6 6"/>'));
  const sync = () => { body.hidden = collapsed; toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} the videos in ${group.title}`); toggle.classList.toggle('open', !collapsed); };
  toggle.addEventListener('click', () => { collapsed = !collapsed; const set = collapsedProjects(); if (collapsed) set.add(key); else set.delete(key); storageSet(collapsedKey(), JSON.stringify([...set])); sync(); });
  sync();
  return el('section', { className: 'pgroup' },
    el('div', { className: 'pgroup-head' }, toggle, el('div', { className: 'pgroup-title' }, el('h2', {}, group.name ? el('a', { href: `#project/${encodeURIComponent(group.name)}` }, group.title) : group.title), group.about && el('p', { className: 'muted' }, group.about)), el('span', { className: 'muted nowrap' }, `${list.length} video${list.length === 1 ? '' : 's'}`)),
    body);
}
function listTools(entries, draw) {
  const chips = el('div', { className: 'chips', role: 'group', 'aria-label': 'Filter videos' });
  const drawChips = () => chips.replaceChildren(...[['all', 'All', entries.length], ['review', 'Needs review', entries.filter(v => v.status === 'review').length], ['finished', 'Finished', entries.filter(v => v.status === 'finished').length], ['raw', 'Not edited', entries.filter(v => v.status === 'raw').length]].map(([id, label, n]) => el('button', { className: id === videoFilter ? 'primary' : 'ghost', 'aria-pressed': String(id === videoFilter), onClick: () => { videoFilter = id; drawChips(); draw(); } }, `${label} · ${n}`)));
  const modes = el('div', { className: 'chips', role: 'group', 'aria-label': 'View' });
  const drawModes = () => modes.replaceChildren(...[['table', 'Table'], ['cards', 'Cards']].map(([id, label]) => el('button', { className: id === listMode ? 'primary' : 'ghost', 'aria-pressed': String(id === listMode), onClick: () => { listMode = id; storageSet('videoView', id); drawModes(); draw(); } }, label)));
  drawChips(); drawModes();
  const search = el('input', { type: 'search', className: 'vsearch', placeholder: 'Find a video by name…', 'aria-label': 'Find a video by name', value: videoQuery, onInput: e => { videoQuery = e.target.value; draw(); } });
  return el('div', { className: 'vtools' }, search, chips, modes);
}
function overviewView() {
  main.append(head('Overview', 'Your projects and the videos inside them. Your AI app makes and changes them; this page shows what exists and where it is.'));
  if (!wsName()) main.append(nameWorkspaceCard());
  const banner = newFootageBanner(); if (banner) main.append(banner);
  const entries = videoEntries();
  const waiting = entries.filter(v => v.status === 'review');
  main.append(waiting.length
    ? el('p', { className: 'attention' }, el('strong', {}, waiting.length === 1 ? '1 video is waiting for your review: ' : `${waiting.length} videos are waiting for your review: `), waiting.map(v => `${v.name} (${draftTitle(latestDraft(v.project).name).split(' · ')[0]})`).join(', '), '.')
    : el('p', { className: 'attention ok' }, 'Nothing is waiting for your review.'));
  main.append(summaryStrip(entries));
  const listBox = el('div', { className: 'plist' });
  const draw = () => {
    const shown = entries.filter(v => (videoFilter === 'all' || v.status === videoFilter) && v.name.toLowerCase().includes(videoQuery.trim().toLowerCase()));
    const filtering = videoFilter !== 'all' || videoQuery.trim();
    const sections = state.projects.map(group => [group, shown.filter(v => v.project?.project === group.name)]).filter(([, list]) => list.length || !filtering).map(([group, list]) => projectSection(group, list, draw));
    const loose = shown.filter(v => !v.project);
    if (loose.length) sections.push(projectSection({ name: '', title: 'Other finished videos', about: 'Finished files that are not inside a project folder.' }, loose, draw));
    listBox.replaceChildren(...(sections.length ? sections : [el('div', { className: 'panel empty' }, entries.length || state.projects.length ? 'No video matches. Clear the search or pick “All”.' : 'No projects yet. Tell your AI app about a new video and it creates the project, the video and a plan for you to check.')]));
  };
  draw();
  main.append(listTools(entries, draw), listBox);
  foldedReference();
}
function projectView() {
  const group = currentGroup();
  if (!group) { main.append(head('Project not found', 'It may have been renamed or removed.'), el('button', { className: 'ghost', onClick: () => goto('overview') }, '← Overview')); return; }
  const entries = videoEntries().filter(v => v.project?.project === group.name);
  const finals = state.finishedVideos.filter(f => f.project === group.name);
  main.append(head(group.title, group.about || 'A project in this workspace.'));
  main.append(el('div', { className: 'row', style: 'margin:-8px 0 22px' }, el('button', { className: 'primary', onClick: () => copy(newVideoInProjectText(group)) }, 'Copy: start a new video here'), revealButton(group.folder, 'Show project folder'), el('span', { className: 'muted' }, 'Paste the instruction in your AI app.')));
  main.append(summaryStrip(entries));
  main.append(el('section', { className: 'pgroup' }, el('div', { className: 'pgroup-head' }, el('h2', {}, 'Videos'), el('span', { className: 'muted' }, `${entries.length}`)), entries.length ? videoTable(entries, () => render()) : el('p', { className: 'muted', style: 'margin:0' }, 'No videos in this project yet.')));
  main.append(el('section', { className: 'pgroup' }, el('div', { className: 'pgroup-head' }, el('h2', {}, 'Finished files'), el('span', { className: 'muted' }, `${finals.length}`)),
    finals.length ? el('div', { className: 'vers' }, finals.map(f => el('div', { className: 'ver' }, el('span', { className: 'vlabel' }, VERSION_LABEL[(/-(vertical|square|youtube)\.mp4$/.exec(f.name) || [])[1] || '']), el('span', {}, f.name), el('span', { className: 'muted' }, `${sizeLabel(f.bytes)} · ${dateLabel(f.modified)}`), revealButton(f.path, 'Show in Finder'), el('a', { className: 'btn', href: mediaURL(f.path), download: f.name }, 'Download'))))
      : el('p', { className: 'muted', style: 'margin:0' }, 'Nothing finished in this project yet. Approved videos are copied to workspace/finished-videos/' + group.name + '/.')));
}
// "This is what I have in mind": the plan your AI app writes (plan.md in the video's folder) before it starts, shown as a page to check.
function planView() {
  const video = currentVideo();
  if (!video) { main.append(head('Video not found', 'It may have been renamed or removed.'), el('button', { className: 'ghost', onClick: () => goto('overview') }, '← Overview')); return; }
  const box = el('article', { className: 'plan' }, el('p', { className: 'muted' }, 'Reading the plan…'));
  main.append(box);
  if (!video.plan) { box.replaceChildren(el('span', { className: 'eyebrow' }, 'Plan'), el('h1', {}, video.name), el('p', { className: 'lede' }, 'There is no plan for this video yet. Ask your AI app: “Write a plan for this video and open it for me.”'), el('button', { className: 'ghost', onClick: () => openVideo(video) }, 'Open the video')); return; }
  api(`/api/document?path=${encodeURIComponent(video.plan)}`).then(({ content }) => {
    const lines = content.replace(/\r/g, '').split('\n');
    const title = lines.find(l => /^# /.test(l))?.slice(2).trim() || `Plan for ${video.name}`;
    const bodyStart = lines.findIndex(l => /^## /.test(l));
    const head = bodyStart < 0 ? lines : lines.slice(0, bodyStart);
    const facts = head.map(l => /^([A-Z][A-Za-z ]{1,24}):[ \t]+(.+)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2]]);
    const body = bodyStart < 0 ? '' : lines.slice(bodyStart).join('\n');
    const go = `The plan for ${video.project}/${video.name} (${video.plan}) is approved. Go ahead and start with the first draft. Follow AGENTS.md, and open the video page for me when the draft is ready.`;
    const change = el('textarea', { rows: 3, placeholder: 'What should change? What should stay?', 'aria-label': 'What to change in the plan' });
    box.replaceChildren(
      el('span', { className: 'eyebrow' }, `Plan · ${currentGroup()?.title || video.project}`),
      el('h1', {}, title),
      el('p', { className: 'lede' }, 'This is what I have in mind. Check it, then tell your AI app to go ahead or what to change.'),
      facts.length ? el('dl', { className: 'facts' }, facts.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v)))) : null,
      body ? renderMarkdown(body) : null,
      el('div', { className: 'plan-actions' },
        el('div', { className: 'row' }, el('button', { className: 'primary', onClick: () => copy(go, 'Copied. Paste it in your AI app to start.') }, 'Looks good, go ahead'), el('span', { className: 'muted' }, 'Copies a short message. Paste it in your AI app.')),
        el('details', {}, el('summary', {}, 'Change something first'), el('div', { className: 'stack', style: 'margin-top:10px' }, change, el('div', { className: 'row' }, el('button', { className: 'ghost', onClick: () => copy(`${readRules}\nAbout the plan for ${video.project}/${video.name} (${video.plan}): ${change.value || '[describe the change]'}\nUpdate plan.md, keep everything I did not mention, and open the plan page again for me.`) }, 'Copy my change'))))),
      el('div', { className: 'row', style: 'margin-top:18px' }, el('button', { className: 'ghost', onClick: () => openVideo(video) }, 'Open the video page'), revealButton(video.folder, 'Show folder in Finder')));
  }).catch(error => box.replaceChildren(el('p', { className: 'error' }, `Could not read the plan: ${error.message}`)));
}
// Folders and instructions: reference material, folded away so the page stays the list.
function foldedReference() {
  const rows = el('div', { className: 'rows' });
  rows.append(folderRow('done', 'Finished videos', state.finishedFolder, 'One file per approved video, in a folder per project: finished-videos/<project>/<video>.mp4. A video with several versions adds -vertical (or -square) and -youtube, so they sit together.'));
  rows.append(folderRow('folder', 'Projects', state.projectsFolder, 'One folder per project, one folder per video inside it: workspace/projects/<project>/<video>/ with source/ (your original footage), drafts/ (every version, never overwritten; voice-only WAVs in drafts/audio/), plan.md, brief.md and feedback.md.', !state.projectsFolderExists && el('span', { className: 'tag bad' }, 'Missing')));
  rows.append(folderRow('drop', 'New footage (optional)', state.dropFolder, 'Copy a new video here in Finder, or simply tell your AI app where the file is. Either works.', state.newVideos.length ? el('span', { className: 'tag on' }, `${state.newVideos.length} waiting`) : null));
  rows.append(el('div', { className: 'frow' }, svgIcon(icons.lock), el('div', {}, el('span', { className: 'name' }, 'system/'), el('p', { className: 'what' }, 'The tools behind this app. Don’t edit, move or delete anything here; ask your AI app instead.')), el('span', { className: 'where mono', title: fullPath('system') }, '…/system/'), el('span', { className: 'tag' }, 'Don’t touch')));
  main.append(el('div', { className: 'block' },
    fold('Where things are in Finder', 'folder map', el('div', {}, el('p', { className: 'root-line' }, 'This workspace’s folder: ', el('span', { className: 'mono' }, state.root), ' — “…” below stands for it.'), rows)),
    fold('Things you can say to your AI app', 'instructions', el('div', { className: 'panel says' },
      sayRow('Open the app', 'Opens this companion.'),
      sayRow('Start a new video', 'Your AI app suggests a project and a name, writes a plan and opens it here for you to check before it starts.', `${readRules}\nI have a new video. Follow "When the user has a new video" in AGENTS.md: find it in the drop folder, suggest a project and a name, write plan.md and open the plan page for me.`),
      sayRow('Open the editor app', 'Opens HyperFrames Studio, where you can tweak a video by hand. Afterwards, tell your AI app what you changed: its next build rewrites the file, so your edits must be carried over.', studioText),
      sayRow('Approve draft 07 of my-video', 'Records the approval and copies that draft to Finished videos. Until you do, the newest draft is not your final video. (You can also press Approve on the video’s page.)'),
      sayRow('Make a clean copy of this workspace for a new brand', 'One brand or client = one copy of this folder. This makes a fresh one with the tools and an empty workspace; your videos here stay untouched.', cleanCopyText(wsName())),
      sayRow('Update this app', 'Gets the latest version of this app and its tools (git pull), without touching your videos. Worth doing every now and then.', updateText)))));
}

function approvalTextFor(project, draft) {
  const relative = draft.path.slice(project.folder.length + 1);
  return `I watched all of ${draft.path} with sound and approve it as the accepted version of ${project.name}. Append this to ${project.folder}/feedback.md, keeping the first two lines exactly as written:\n## Approved version\nDraft: ${relative}\nApproved by the owner on <today's date> after a full review.\nThen copy it to workspace/finished-videos/${project.project}/${project.name}.mp4 (add -vertical, -square or -youtube if the video has several versions) and make its poster.jpg. Do not re-render, change the video or promote anything to my reusable style.`;
}
function videoPage() {
  const project = currentVideo();
  if (!project) { main.append(head('Video not found', 'It may have been renamed or removed.'), el('button', { className: 'ghost', onClick: () => goto('overview') }, '← Overview')); return; }
  const draft = project.drafts.find(d => d.path === selectedDraft) || project.drafts.find(d => d.path === project.approved) || project.drafts.at(-1);
  selectedDraft = draft?.path; lastVideo = project;
  main.append(el('div', { className: 'ws-head' },
    el('div', {}, el('h1', {}, project.name), el('p', { className: 'lede' }, `${currentGroup()?.title || project.project} · review drafts, compare versions, and continue working in your AI app.`)),
    el('div', { className: 'row', style: 'align-items:flex-end' }, project.plan && el('button', { className: 'ghost', onClick: () => openPlan(project) }, 'View plan'), revealButton(project.folder, 'Show folder in Finder'))));
  const finals = finalsFor(project);
  const nudgeShown = needsApproval(project) && !isDismissed(project, latestDraft(project));
  if (finals.length || !nudgeShown) main.append(el('section', { className: 'finals' }, el('span', { className: 'label' }, finals.length ? 'Final video' : 'Final video · none yet'),
    finals.length ? finals.map(f => el('div', { className: 'ver' }, el('span', { className: 'vlabel' }, VERSION_LABEL[f.version]), el('span', { className: 'muted' }, `${f.name} · ${sizeLabel(f.bytes)} · ${dateLabel(f.modified)}${finalSource(project, f) ? ` · from ${draftTitle(finalSource(project, f).name).split(' · ')[0]}` : ''}`), el('div', { className: 'row' }, revealButton(f.path, 'Show in Finder'), el('a', { className: 'btn', href: mediaURL(f.path), download: f.name }, 'Download'), copyPathButton(f.path))))
      : el('p', { className: 'muted', style: 'margin:6px 0 0' }, 'When you approve a draft, your AI app copies it to Finished videos and it shows up here.')));
  if (needsApproval(project) && !isDismissed(project, latestDraft(project))) {
    const latest = latestDraft(project);
    main.append(el('div', { className: 'nudge', role: 'note' },
      el('div', {}, el('strong', {}, `${draftTitle(latest.name)} is not approved yet.`), el('span', {}, project.approved ? ' Your finished video is still an older draft. ' : ' Nothing is in Finished videos yet. ', 'Happy with it? Watch it all with sound, then approve it so it becomes your finished video.'), approveControls(project, latest, { dismissible: true }))));
  }
  // Left: preview + metadata.
  const stage = el('div', { className: 'stage' });
  const meta = el('div', { className: 'meta' });
  if (draft) {
    const kv = (k, v, id) => el('div', { className: 'kv' }, el('span', { className: 'label' }, k), el('b', { id, title: v }, v));
    const player = el('video', { controls: true, playsInline: true, preload: 'metadata', src: mediaURL(draft.path) });
    player.addEventListener('loadedmetadata', () => {
      const d = $('#meta-duration'), r = $('#meta-resolution');
      if (d) d.textContent = timeLabel(player.duration) || '—';
      if (r) r.textContent = player.videoWidth ? `${player.videoWidth} × ${player.videoHeight}` : '—';
    });
    player.addEventListener('error', () => {
      stage.append(el('div', { className: 'stage-msg' }, 'This browser can’t play this file (missing, or a codec like HEVC/HDR). Open it in QuickTime — copy its path below. Files are never converted here.'));
      for (const id of ['#meta-duration', '#meta-resolution']) { const n = $(id); if (n) n.textContent = '—'; }
    });
    stage.append(player);
    meta.append(kv('Draft', draftTitle(draft.name)), kv('Duration', '…', 'meta-duration'), kv('Resolution', '…', 'meta-resolution'), kv('Format', draft.name.split('.').pop().toUpperCase()), kv('Size', sizeLabel(draft.bytes)), kv('Exported', dateLabel(draft.modified)),
      el('div', { className: 'actions' }, revealButton(draft.path), el('a', { className: 'btn', href: mediaURL(draft.path), download: draft.name }, 'Download'), copyPathButton(draft.path)));
  } else {
    stage.append(el('div', { className: 'stage-msg', style: 'position:static' }, 'No exports yet. Ask your AI app for a playable opening draft, not just a plan.'));
  }

  // Right: drafts, approval, feedback.
  const side = el('div', { className: 'side' });
  const list = el('div', { className: 'drafts', role: 'list' });
  [...project.drafts].reverse().forEach(d => list.append(el('button', { role: 'listitem', 'aria-current': String(d.path === draft?.path), className: d.path === project.approved ? 'approved' : '', onClick: () => { selectedDraft = d.path; render(); } },
    el('span', { className: 'n' }, draftNumber(d.name) || '·'), el('span', { className: 't', title: d.name }, draftTitle(d.name)), d.path === project.approved ? el('span', { className: 'tag ok' }, '✓ Approved') : finalsFor(project).some(f => finalSource(project, f)?.path === d.path) ? el('span', { className: 'tag ok' }, `✓ ${VERSION_SHORT[finalsFor(project).find(f => finalSource(project, f)?.path === d.path).version]}`) : el('span'),
    el('span', { className: 's' }, `${dateLabel(d.modified)} · ${sizeLabel(d.bytes)}`))));
  side.append(el('section', {}, el('div', { className: 'row between' }, el('span', { className: 'label' }, 'Drafts · newest first'), el('span', { className: 'mono muted' }, String(project.drafts.length))), project.drafts.length ? list : el('p', { className: 'muted', style: 'margin:10px 0 0' }, 'No drafts in drafts/ yet.')));
  if (draft) {
    const approvalText = approvalTextFor(project, draft);
    side.append(el('section', {}, el('span', { className: 'label' }, 'Approval'), el('div', { style: 'margin-top:10px' },
      draft.path === project.approved ? el('p', { style: 'margin:0' }, el('span', { className: 'tag on' }, 'Approved version'), el('span', { className: 'muted' }, ' · copied to finished-videos by your AI app'))
        : nudgeShown && draft.path === latestDraft(project).path ? el('p', { className: 'muted', style: 'margin:0' }, 'Use the Approve button at the top of this page.')
        : el('div', {}, approveControls(project, draft), project.approved && el('p', { className: 'muted', style: 'margin:8px 0 0' }, 'Replaces the current approval.')))));
  }
  const stamp = el('input', { placeholder: '00:08–00:12', 'aria-label': 'Timestamp' });
  const change = el('textarea', { rows: 4, placeholder: 'What should change? What must stay the same?', 'aria-label': 'Feedback' });
  const feedbackText = () => `${readRules}\nProject: ${project.name}\nDraft: ${draft ? draft.path : '(none yet — prepare a numbered 15-second opening once inputs are ready)'}\n\nFeedback${stamp.value ? ` at ${stamp.value}` : ''}:\n${change.value || '[describe the change and what must stay unchanged]'}\n\nRecord these notes in ${project.folder}/feedback.md. Preserve approved elements; save a new numbered draft without overwriting previous versions. Explain any timing impact. Hand me a playable MP4 and report unresolved limitations.`;
  side.append(el('section', {}, el('span', { className: 'label' }, 'Feedback: 1. write it, 2. copy, 3. paste in your AI app'),
    el('label', { className: 'field' }, el('span', {}, 'Timestamp (optional)'), stamp),
    el('label', { className: 'field' }, el('span', {}, 'What should change'), change),
    el('div', { className: 'row', style: 'margin-top:12px' }, el('button', { className: 'primary', onClick: () => copy(feedbackText()) }, 'Copy feedback for your AI app'), el('span', { className: 'muted' }, 'Paste it in your AI app’s chat.')),
    el('details', { className: 'tip' }, el('summary', {}, 'Get help tidying long notes'),
      el('ol', { className: 'steps' },
        el('li', {}, 'Write your notes the way they come (or collect them from a teammate).'),
        el('li', {}, 'Paste them into ChatGPT or a similar assistant with the template below. It turns them into a precise brief: timestamps, what to change, what must stay the same.'),
        el('li', {}, 'Read the result, fix anything it got wrong, then paste it into your AI app.')),
      el('p', { className: 'muted' }, 'Precise, surgical briefs get precise edits; vague ones invite redesigns.'),
      copyBlock(polishTemplate(project), 'Copy template'))));
  main.append(el('div', { className: 'ws-grid' }, el('div', {}, stage, draft && meta), side));

  // Below: secondary resources.
  const source = el('div', { className: 'stack' });
  if (!project.sourceExists) source.append(el('p', { className: 'muted' }, 'This project has no source/ folder. Its original footage may be stored elsewhere; the brief records where.'));
  else {
    source.append(el('div', { className: 'row between' }, el('span', { className: 'mono muted', title: fullPath(`${project.folder}/source`) }, `${project.folder}/source`), el('div', { className: 'row' }, revealButton(`${project.folder}/source`), copyPathButton(`${project.folder}/source`, 'Copy folder path'))));
    source.append(project.source.length ? el('div', { className: 'file-list' }, project.source.map(f => el('div', {}, el('span', {}, f.name), el('span', { className: 'mono muted' }, `${sizeLabel(f.bytes)} · ${dateLabel(f.modified)}`)))) : el('p', { className: 'muted' }, 'The source folder is empty.'));
  }
  const fullEdit = `${readRules}\nRead ${project.folder}/brief.md and feedback.md. ${draft ? `Use ${draft.path} as the baseline only if its treatment is approved in the feedback.` : 'Obtain opening approval first.'} Extend approved treatment to the full video, preserving approved timing and layout. Verify the remaining transcript; do not invent unclear words. Save a new numbered export. Check the actual output end to end, report limitations, and wait for my full-video review.`;
  main.append(el('div', { className: 'block' }, el('span', { className: 'label' }, 'Project resources'),
    fold('Original footage', sourceStatus(project), source),
    fold('Brief', 'brief.md', docView(`${project.folder}/brief.md`)),
    fold('Feedback & context', 'feedback.md · by draft', feedbackHistory(project, draft)),
    fold('Next step: extend to the full video', 'instruction', copyBlock(fullEdit, 'Copy instruction for your AI app', 'Use after the opening is approved.'))));
}

function feedbackHistory(project, draft) {
  const box = el('div', { className: 'stack' },
    el('div', { className: 'context-note' }, el('strong', {}, 'How your AI app remembers'),
      el('p', {}, 'This app keeps no memory of its own. Before every edit your AI app re-reads the whole feedback.md — every review and note since draft 01. Older notes stay in force until you say they are done, which is why they can keep coming back.')),
    copyBlock(closeNotesText(project, draft), `Copy “earlier notes are settled”`, `Up to ${draft ? stem(draft.name) : 'the current draft'}.`));
  const list = el('div', { className: 'history' }, el('p', { className: 'muted' }, 'Reading…'));
  box.append(list, el('details', {}, el('summary', { className: 'muted' }, 'Whole file'), docView(`${project.folder}/feedback.md`)));
  api(`/api/document?path=${encodeURIComponent(`${project.folder}/feedback.md`)}`).then(({ content }) => {
    const sections = feedbackSections(content);
    list.replaceChildren(...(sections.length ? sections.map((sec, i) => el('details', { className: 'hitem', open: i === 0 },
      el('summary', {}, el('span', { className: 'mono muted n' }, sec.draft ? `draft ${pad(Number(sec.draft))}` : '—'), el('span', { className: 't' }, sec.title), sec.approval ? el('span', { className: 'tag ok' }, 'Approval') : null),
      renderMarkdown(sec.body || '(empty)'))) : [el('p', { className: 'muted' }, 'No notes yet.')]));
  }).catch(error => list.replaceChildren(el('p', { className: 'error' }, `Could not read feedback.md: ${error.message}`)));
  return box;
}
const SOUND_TOPICS = [['Transitions & whooshes', /whoosh|woosh|swoosh|sweep|swish|swipe|transition|zoom|vacuum|flashback/i], ['Pops, clicks & typing', /pop|click|tap|key|typing|land/i], ['Impacts & risers', /impact|riser|hit|boom|thunder|laser/i], ['Reactions & people', /laugh|cheer|applause|gasp|crowd|sneeze|trombone|fail|fanfare|roar|bark/i], ['Alerts & interface', /notification|chime|ping|sparkle|alert|alarm|bleep|ringtone|game|error|glitch|tick|clock/i], ['Water, ambience & other', /./]];
const MORE = [
  ['Sound effects', [['Mixkit', 'https://mixkit.co/free-sound-effects/'], ['Pixabay', 'https://pixabay.com/sound-effects/']]],
  ['Music', [['Mixkit', 'https://mixkit.co/free-stock-music/'], ['Pixabay', 'https://pixabay.com/music/']]],
  ['Animations', [['LottieFiles', 'https://lottiefiles.com/free-animations']]],
  ['Illustrations', [['Craftwork', 'https://craftwork.design/downloads/open-stickers/']]],
  ['Icons', [['Phosphor', 'https://phosphoricons.com']]],
  ['Fonts', [['Google Fonts (open licence)', 'https://fonts.google.com']]],
];
function assetOverviewView(lib) {
  const o = state.assetOverview || { sounds: [], music: [], fonts: [], counts: {} };
  const ext = { target: '_blank', rel: 'noopener noreferrer' };
  const box = el('div', { className: 'stack' },
    el('div', { className: 'asset-counts' }, [['Sounds', o.sounds.length], ['Music', o.music.length], ['Fonts', o.fonts.length], ['Icons', o.counts.icons || 0], ['Animations', o.counts.animations || 0], ['Illustrations', o.counts.illustrations || 0]].map(([k, v]) => el('div', {}, el('b', {}, v.toLocaleString()), el('span', { className: 'label' }, k)))));
  const player = a => el('div', {}, el('span', {}, el('span', { className: 'mono' }, a.name), a.source ? el('span', { className: 'muted' }, ` · ${a.source}`) : ''), el('audio', { src: mediaURL(a.path), controls: true, preload: 'none' }));
  const used = new Set();
  for (const [topic, re] of SOUND_TOPICS) {
    const list = o.sounds.filter(a => !used.has(a.path) && re.test(a.name)); list.forEach(a => used.add(a.path));
    if (list.length) box.append(el('details', { className: 'topic' }, el('summary', {}, el('strong', {}, topic), el('span', { className: 'muted' }, ` · ${list.length} sound${list.length === 1 ? '' : 's'}`)), el('div', { className: 'file-list' }, list.map(player))));
  }
  box.append(el('details', { className: 'topic' }, el('summary', {}, el('strong', {}, 'Music'), el('span', { className: 'muted' }, ` · ${o.music.length}`)), o.music.length ? el('div', { className: 'file-list' }, o.music.map(player)) : el('p', { className: 'muted' }, 'No music yet. Your exports ship without music; add your own afterwards.')));
  box.append(el('details', { className: 'topic' }, el('summary', {}, el('strong', {}, 'Fonts'), el('span', { className: 'muted' }, ` · ${o.fonts.length} files`)), el('div', { className: 'file-list' }, o.fonts.map(f => el('div', {}, el('span', { className: 'mono' }, f.name), el('span', { className: 'muted' }, f.source))))));
  box.append(el('h3', { style: 'margin-top:8px' }, 'Get more'),
    el('div', { className: 'more-grid' }, MORE.map(([topic, links]) => el('div', {}, el('span', { className: 'label' }, topic), ...links.map(([name, href]) => el('a', { href, ...ext }, `${name} ↗`))))),
    el('p', { className: 'muted' }, 'Download in your browser, then tell your AI app: “I downloaded <file> to Downloads, add it to my assets.” It checks the licence, files it and records it in your asset index. Files you download stay on your Mac and out of git.'));
  if (lib) box.append(el('details', {}, el('summary', { className: 'muted' }, `Library packs (${lib.available} of ${lib.catalogued} catalogued assets installed)`), el('div', { className: 'file-list', style: 'margin-top:10px' }, lib.sources.map(s => el('div', {}, el('span', {}, el('strong', {}, s.id), el('span', { className: 'muted' }, s.acquisition === 'manual' ? ' · manual download' : ''), s.url ? el('a', { href: s.url, ...ext, style: 'margin-left:8px' }, 'site ↗') : ''), s.installed ? el('span', { className: 'tag ok' }, `${s.files} files`) : el('span', { className: 'tag' }, s.acquisition === 'manual' ? 'Not downloaded' : 'Not installed'))))));
  box.append(el('h3', { style: 'margin-top:8px' }, 'Your asset index'), docView('workspace/assets/asset-index.md'));
  return box;
}
// Brand page: everything is read from the editing guide, so it always shows the saved brand (nothing is stored here).
function brandFromGuide(text) {
  const section = name => { const m = new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text); return m ? m[1] : ''; };
  const colour = section('Colou?r');
  const palette = [...colour.matchAll(/([A-Z][A-Za-z-]*(?: [A-Za-z-]+)?) (#[0-9A-Fa-f]{6})/g)].map(m => ({ name: m[1], hex: m[2].toUpperCase() }))
    .filter((p, i, all) => all.findIndex(q => q.hex === p.hex) === i);
  const find = name => palette.find(p => p.name.toLowerCase() === name.toLowerCase())?.hex;
  const capBox = /Caption box (#[0-9A-Fa-f]{6})/i.exec(text)?.[1], highlight = /highlight block (#[0-9A-Fa-f]{6})/i.exec(text)?.[1];
  const fonts = section('Fonts and lettering').split('\n').filter(l => /^(Title font|Spoken-caption font|Accent font)/.test(l));
  const reference = /(workspace\/finished-videos\/[^\s(),]+\.mp4)/.exec(text)?.[1];
  const identity = /^Visual identity[^:]*: (.*)$/m.exec(text)?.[1];
  return { palette, paper: find('Paper'), sunk: find('Paper-sunk'), ink: find('Ink'), muted: find('Ink-muted'), line: find('Line'), accent: find('Mauve'), capBox, highlight, fonts, reference, identity };
}
function brandView() {
  main.append(head('Brand', 'How your videos look, shown from your editing guide. To change it, tell your AI app.'));
  const box = el('div', {}, el('p', { className: 'muted' }, 'Reading your editing guide…'));
  main.append(box);
  api('/api/document?path=workspace%2Fpreferences%2Fediting-guide.md').then(({ content }) => {
    const b = brandFromGuide(content);
    if (!b.palette.length) { box.replaceChildren(el('div', { className: 'panel empty' }, 'Your editing guide has no colour palette yet. Ask your AI app to record your brand colours in workspace/preferences/editing-guide.md.')); return; }
    const paint = (node, styles) => { Object.assign(node.style, styles); return node; };
    const paper = b.paper || '#F7F4EE', sunk = b.sunk || paper, ink = b.ink || '#16140F', muted = b.muted || ink, line = b.line || sunk, accent = b.accent || ink;
    const swatches = el('div', { className: 'swatches' }, b.palette.map(p => el('div', { className: 'swatch' }, paint(el('i'), { background: p.hex }), el('b', {}, p.name), el('span', { className: 'mono muted' }, p.hex))));
    const title = paint(el('div', { className: 'specimen' }), { background: paper, color: ink, borderColor: line });
    const headline = el('div', { className: 'h-mono' }, 'One idea. ', el('b', {}, 'One scene.'));
    // The ensō: an open ring drawn in ink, with the frame's one accent dot beside it.
    const svgNS = 'http://www.w3.org/2000/svg', enso = document.createElementNS(svgNS, 'svg');
    enso.setAttribute('viewBox', '0 0 240 240'); enso.setAttribute('class', 'enso'); enso.setAttribute('aria-hidden', 'true');
    const ring = document.createElementNS(svgNS, 'path'); ring.setAttribute('d', 'M202.69 89.9 A88 88 0 1 1 135.28 33.34');
    Object.entries({ fill: 'none', stroke: ink, 'stroke-width': 14, 'stroke-linecap': 'round' }).forEach(([k, v]) => ring.setAttribute(k, v));
    const dot = document.createElementNS(svgNS, 'circle'); Object.entries({ cx: 190, cy: 38, r: 14, fill: accent }).forEach(([k, v]) => dot.setAttribute(k, v));
    enso.append(ring, dot);
    title.append(paint(el('span', { className: 'eyebrow' }, '1. The problem'), { color: muted }), headline, enso);
    const caption = paint(el('div', { className: 'cap-stage' }), { background: '#cfcac3' });
    const cap = paint(el('div', { className: 'cap-box' }), { background: b.capBox || ink, color: paper });
    ['I', 'totally', 'suck', 'at', 'it.'].forEach(w => cap.append(w === 'suck' ? paint(el('span', { className: 'hl' }, w), { background: b.highlight || sunk, color: ink }) : el('span', {}, w)));
    caption.append(cap);
    const card = paint(el('div', { className: 'card-sample' }), { background: sunk, color: ink, borderColor: line });
    const shot = paint(el('div', { className: 'shot' }, el('i'), el('i'), el('i')), { borderColor: line });
    shot.querySelectorAll('i').forEach(i => { i.style.background = line; });
    card.append(paint(el('span', { className: 'clabel' }, 'Skills, assets & tools · installed'), { color: muted }), shot, el('div', { className: 'cfoot' }, 'Set it up ', el('b', {}, 'once.')));
    const cardStage = paint(el('div', { className: 'card-stage' }), { background: paper, borderColor: line }); cardStage.append(card);
    box.replaceChildren(...[
      b.identity && fold('About this brand', 'from your guide', inline(b.identity, el('p', { className: 'identity' }))),
      el('div', { className: 'block' }, el('span', { className: 'label' }, 'Palette'), swatches),
      el('div', { className: 'block' }, el('span', { className: 'label' }, 'Type, captions and cards'), el('div', { className: 'brand-grid' },
        el('figure', {}, title, el('figcaption', { className: 'muted' }, 'Typographic beat on paper: mono eyebrow, mono headline with the key words in bold, the ensō with one mauve dot.')),
        el('figure', {}, caption, el('figcaption', { className: 'muted' }, 'Captions: phrase in an ink box, the spoken word on a paper-sunk block.')),
        el('figure', {}, cardStage, el('figcaption', { className: 'muted' }, 'Cards: paper-sunk, hairline, mono label, the cropped screenshot, a sans footer.')))),
      b.fonts.length && fold('Fonts', 'details from your guide', el('div', { className: 'panel-body doc' }, b.fonts.map(f => inline(f, el('p'))))),
      b.reference && el('div', { className: 'block' }, el('span', { className: 'label' }, 'Reference video'), el('div', { className: 'ref' }, el('video', { controls: true, playsInline: true, preload: 'metadata', src: mediaURL(b.reference) }), el('div', { className: 'stack' }, el('p', {}, 'The approved edit this brand comes from. New videos start from it.'), el('div', { className: 'row' }, revealButton(b.reference), copyPathButton(b.reference))))),
      el('p', { className: 'muted', style: 'margin-top:24px' }, 'Shown from workspace/preferences/editing-guide.md. These are browser previews in standard colour; your videos are rendered in HDR with matching colours.')].filter(Boolean));
  }).catch(error => box.replaceChildren(el('p', { className: 'error' }, `Could not read your editing guide: ${error.message}`)));
}
function statusRow(name, tag, detail) { return [el('div', {}, el('strong', {}, name)), el('div', { className: 'detail' }, detail || ''), el('div', {}, tag)]; }
function workspaceCard() {
  const name = wsName();
  const steps = [
    ['Name this workspace', Boolean(name), name ? `“${name}”` : 'Ask your AI app to set it up.'],
    ['Tools and asset library', Boolean(state.library?.available), state.library?.available ? 'Ready.' : 'Ask your AI app: “Set up the asset library.”'],
    ['First video started', state.videos.length > 0, state.videos.length ? `${state.videos.length} video${state.videos.length === 1 ? '' : 's'}.` : 'Copy a video into the drop folder.'],
    ['First video finished', state.finishedVideos.length > 0, state.finishedVideos.length ? 'Approved and copied to Finished videos.' : 'Approve a draft to finish one.']];
  return el('div', { className: 'panel ws-card' },
    el('div', { className: 'row between' }, el('div', {}, el('span', { className: 'label' }, 'This workspace'), el('h2', {}, name || 'Not named yet')), name ? el('span', { className: 'mono muted', title: fullPath(state.workspace.file) }, state.workspace.file) : el('button', { className: 'primary', onClick: () => copy(nameWorkspaceText) }, 'Copy naming instruction')),
    el('p', { className: 'copy-note' }, el('strong', {}, 'One brand or client = one copy of this folder. '), copyReminder.replace('One brand or client = one copy of this folder. ', '')),
    el('div', { className: 'row' }, el('button', { className: 'ghost', onClick: () => copy(cleanCopyText(name)) }, 'Copy “make a clean copy” instruction'), el('span', { className: 'muted' }, 'Your videos here stay untouched. All copies on this Mac share one ElevenLabs account.')),
    steps.every(x => x[1]) ? el('p', { className: 'muted', style: 'margin:0' }, '✓ Set up: workspace named, tools ready, first video started and finished.') : el('ul', { className: 'checks' }, steps.map(([label, done, note]) => el('li', { className: done ? 'done' : '' }, el('span', { className: 'tick' }, done ? '✓' : '○'), el('strong', {}, label), el('span', { className: 'muted' }, note)))));
}
function setupView() {
  main.append(el('div', { className: 'setup-head' }, head('Setup & preferences', 'Configure your editing environment and manage resources.'),
    el('div', { className: 'disclaimer', role: 'note' }, el('strong', {}, 'This page only shows what your AI app has set up.'), el('span', {}, 'To change any setting, ask your AI app in the chat. The only things this app does itself: saving your ElevenLabs key (so it never goes through the chat) and Show in Finder.'))));
  main.append(workspaceCard());
  if (!tools.checked && !tools.loading) {
    tools.loading = true;
    api('/api/tools').then(result => { tools.result = result; tools.error = null; }).catch(error => { tools.error = error.message; }).finally(() => { tools.checked = true; tools.loading = false; if (route.name === 'setup') render(); });
  }
  const lib = state.library;
  const manualMissing = lib ? lib.sources.filter(s => s.acquisition === 'manual' && !s.installed) : [];
  const toolRow = (name, probe) => !tools.checked ? statusRow(name, el('span', { className: 'tag' }, 'Checking…'), 'Looking for it on this Mac.')
    : tools.error ? statusRow(name, el('span', { className: 'tag bad' }, 'Error'), tools.error)
    : probe.detected ? statusRow(name, el('span', { className: 'tag ok' }, 'Ready'), probe.version) : statusRow(name, el('span', { className: 'tag bad' }, 'Needs fixing'), 'Not found. Tell your AI app: “Fix my setup.”');
  const status = el('div', { className: 'status' },
    statusRow('Project folder', state.projectsFolderExists ? el('span', { className: 'tag ok' }, 'Found') : el('span', { className: 'tag bad' }, 'Missing'), el('span', { className: 'mono', title: fullPath(state.projectsFolder) }, `${state.projectsFolder}/`)),
    statusRow('Asset library', !lib ? el('span', { className: 'tag' }, 'Unavailable') : lib.available ? el('span', { className: 'tag ok' }, 'Ready') : el('span', { className: 'tag bad' }, 'Not set up'),
      !lib ? 'Could not read system/assets/catalog.json.' : lib.available ? `${lib.available} of ${lib.catalogued} catalogued assets installed${manualMissing.length ? ` · ${manualMissing.length} optional packs not downloaded` : ''}` : 'Tell your AI app: “Set up the asset library.”'),
    toolRow('Node.js (runs this app)', tools.result && { detected: true, version: tools.result.node }),
    toolRow('FFmpeg (video and audio tools)', tools.result?.ffmpeg),
    toolRow('Whisper (speech to text)', tools.result?.whisper));
  const check = el('button', { className: 'ghost', onClick: async () => { check.disabled = true; try { tools.result = await api('/api/tools'); tools.error = null; } catch (error) { tools.error = error.message; } tools.checked = true; render(); } }, 'Check again');
  main.append(el('div', { className: 'panel' }, el('div', { className: 'panel-head' }, el('h2', {}, 'System status'), check), status,
    tools.checked && !tools.error && el('p', { className: 'muted', style: 'margin:0;padding:10px 18px;border-top:1px solid var(--line);font-size:13px' }, 'This only looks for the tools. A short test video made by your AI app is what proves the setup works.')));

  const repo = state.repo;
  main.append(el('section', { className: 'panel' }, el('div', { className: 'panel-head' }, el('div', {}, el('h2', {}, 'Keep this app up to date'), el('p', { className: 'muted', style: 'margin:2px 0 0;font-size:13.5px' }, 'The app and its tools get improvements every now and then. Your videos, preferences and assets are never touched by an update.')), el('span', { className: 'tag' }, repo?.lastChanged ? `Last changed ${dateLabel(repo.lastChanged)}` : 'Not a git copy')),
    el('div', { className: 'panel-body' }, copyBlock(updateText, 'Copy update instruction', 'Paste it into your AI app, e.g. once a month.'))));
  main.append(voicePanel());

  const setupText = `${readRules}\nInspect this machine and identify its OS before installing anything. Set up only missing editing tools using official instructions, plus the optional voiceover tools (npm --prefix system/voiceover ci). Use a small source clip I supply to produce a playable test MP4. Record versions, paths and unresolved limitations in system/setup/setup-notes.md. Do not call setup complete until the test plays.`;
  const env = el('div', { className: 'stack' },
    el('h3', {}, 'Initial installation'), copyBlock(setupText, 'Copy setup instruction', 'For a new machine or missing tools.'),
    el('h3', { style: 'margin-top:12px' }, 'Current environment'), docView('system/setup/setup-notes.md'),
    el('h3', { style: 'margin-top:12px' }, 'Troubleshooting'), el('p', { className: 'muted' }, 'Describe the problem to your AI app in plain words. For problems with this companion, ask it to run the app tests (npm --prefix system/app test) and restart it.'),
    el('h3', { style: 'margin-top:12px' }, 'Prompt library'), docView('system/prompts.md'));

  const libBody = assetOverviewView(lib);

  const scope = el('select', { 'aria-label': 'Preference scope' }, el('option', { value: 'guide' }, 'Propose reusable preferences'), el('option', { value: 'video' }, 'Propose choices for the current video only'));
  const preview = el('pre', { className: 'preview' });
  const promptText = () => {
    const selected = factors.filter(f => choices.has(f.id)).map(f => `- ${f.title}: ${f.instructions[choices.get(f.id)]}`);
    return selected.length ? `${readRules}\n${scope.value === 'guide' ? 'These are proposed reusable preferences. Reconcile them with the current guide; ask about conflicts before changing approved choices. Save agreed preferences in workspace/preferences/editing-guide.md.' : lastVideo ? `These choices apply only to workspace/projects/${lastVideo.project}/${lastVideo.name}. Read its brief and feedback. Save agreed choices in this video’s brief; do not promote them to universal defaults.` : 'These choices apply to one video only. Ask me which project before saving them.'}\n${selected.join('\n')}\nThese UI illustrations do not approve a font, exact size, color or asset. Preserve other approved elements. Do not render until I request a draft.` : '';
  };
  const copyChoices = el('button', { className: 'primary', onClick: () => copy(promptText()) }, 'Copy choices for your AI app');
  const updatePrompt = () => { const t = promptText(); preview.textContent = t || 'Select a factor to build an instruction. Nothing is saved to your guide.'; copyChoices.disabled = !t; };
  scope.addEventListener('change', updatePrompt);
  const grid = el('div', { className: 'factor-grid' });
  for (const factor of factors) {
    const demo = factor.demo(); demo.dataset.factor = factor.id; demo.dataset.choice = choices.has(factor.id) ? choices.get(factor.id) : 'illustration';
    const options = el('div', { className: 'options' });
    factor.options.forEach((text, index) => options.append(el('button', { 'aria-pressed': String(choices.get(factor.id) === index), onClick: () => {
      if (choices.get(factor.id) === index) choices.delete(factor.id); else choices.set(factor.id, index);
      [...options.children].forEach((b, i) => b.setAttribute('aria-pressed', String(choices.get(factor.id) === i)));
      demo.dataset.choice = choices.has(factor.id) ? choices.get(factor.id) : 'illustration'; updatePrompt();
    } }, text)));
    grid.append(el('div', { className: 'factor' }, demo, el('h3', {}, factor.title), el('p', { className: 'muted', style: 'margin:0;font-size:13.5px' }, factor.hint), options));
  }
  updatePrompt();
  const explore = el('div', { className: 'stack' }, el('p', { className: 'muted' }, 'Neutral illustrations, not video previews. Selections only build an instruction; your saved style does not change.'), grid, el('div', { className: 'row' }, scope, copyChoices), preview);

  main.append(el('div', { className: 'block' }, el('span', { className: 'label' }, 'Configuration'),
    fold('Editing preferences', 'guide · rules', docSwitcher(['workspace/preferences/editing-guide.md', 'workspace/preferences/editing-rules.md'])),
    fold('Tools & environment', 'install · environment · help', env),
    fold('Assets', 'overview by topic · get more', libBody),
    fold('Explore editing factors', 'advanced', explore)));
}

const voiceExample = 'Add a warm, cinematic voiceover to this video with animated captions. Show me the script, the voice and the cost before generating anything.';
function voicePanel() {
  const v = state.voiceover;
  const panel = el('section', { className: 'panel', id: 'elevenlabs', 'aria-labelledby': 'elevenlabs-title' });
  const tag = !v ? el('span', { className: 'tag' }, 'Unavailable') : v.connected ? el('span', { className: 'tag ok' }, 'Connected') : el('span', { className: 'tag' }, 'Not connected');
  panel.append(el('div', { className: 'panel-head' }, el('div', {}, el('h2', { id: 'elevenlabs-title' }, 'ElevenLabs'), el('p', { className: 'muted', style: 'margin:2px 0 0;font-size:13.5px' }, 'Expressive AI voiceovers with automatically synced captions. Optional.')), tag));
  const body = el('div', { className: 'panel-body stack' });
  panel.append(body);
  if (!v) { body.append(el('p', { className: 'error' }, 'Could not read the voiceover status. Ask your AI app to check system/voiceover.')); return panel; }

  const errorLine = voice.error ? el('p', { className: 'error', role: 'alert' }, voice.error) : '';
  const form = () => {
    const input = el('input', { type: 'password', id: 'elevenlabs-key', autocomplete: 'off', spellcheck: false, placeholder: 'sk_…', 'aria-label': 'ElevenLabs API key', disabled: voice.busy || !v.sdkInstalled });
    const submit = el('button', { className: 'primary', type: 'submit', disabled: voice.busy || !v.sdkInstalled }, voice.busy ? 'Checking…' : v.connected ? 'Save new key' : 'Connect');
    const f = el('form', { className: 'key-form', onSubmit: async event => {
      event.preventDefault();
      const apiKey = input.value.trim(); input.value = '';
      if (!apiKey) { voice.error = 'Paste your API key first.'; render(); return; }
      voice.busy = true; voice.error = null; render();
      try { state.voiceover = await post('/api/voiceover/connect', { apiKey }); voice.editing = false; message('ElevenLabs connected. The key is saved in your Mac’s Keychain.'); }
      catch (error) { voice.error = error.message; }
      voice.busy = false; render();
    } }, input, submit, v.connected && el('button', { type: 'button', className: 'ghost', onClick: () => { voice.editing = false; voice.error = null; render(); } }, 'Cancel'));
    return f;
  };

  if (!v.connected || voice.editing) {
    if (!v.connected) body.append(el('p', {}, 'Generating speech uses credits from your ElevenLabs plan. Your AI app always shows you the script, the voice and the estimated cost, and waits for your OK before spending anything.'));
    if (!v.sdkInstalled) body.append(el('div', { className: 'stack' }, el('p', { className: 'error' }, 'The voiceover tools are not installed yet.'), copyBlock('Install the voiceover tools (npm --prefix system/voiceover ci) and tell me when the ElevenLabs Connect button is ready.', 'Copy instruction for your AI app')));
    body.append(el('ol', { className: 'steps' },
      el('li', {}, 'Open ', el('a', { href: 'https://elevenlabs.io/app/settings/api-keys', target: '_blank', rel: 'noopener noreferrer' }, 'ElevenLabs → API keys'), ' and sign in (a free account works to start).'),
      el('li', {}, 'Create a key. Turn on ', el('strong', {}, 'Text to Speech'), '. Also allow reading ', el('strong', {}, 'Voices'), ' and ', el('strong', {}, 'User'), ' so voices can be listed and your account shown here.'),
      el('li', {}, 'Set a ', el('strong', {}, 'credit limit'), ' on the key that you are comfortable with. ElevenLabs stops the key there.'),
      el('li', {}, 'Paste the key below. It is saved in your Mac’s Keychain, never in project files, and is never shown again.')),
      form(), errorLine);
    if (!v.connected) body.append(el('p', { className: 'muted', style: 'margin:0;font-size:13px' }, 'Connecting only checks the key with ElevenLabs. It does not generate audio or use credits.'));
    return panel;
  }

  const c = v.checks || {}, a = v.account;
  const yes = text => el('span', { className: 'tag ok' }, text), no = text => el('span', { className: 'tag' }, text);
  const credits = a && Number.isFinite(a.characterLimit) ? `${a.characterCount.toLocaleString()} of ${a.characterLimit.toLocaleString()} credits used${a.resetsAt ? ` · resets ${dateLabel(a.resetsAt)}` : ''}` : '';
  const pct = a && Number.isFinite(a.characterLimit) && a.characterLimit ? Math.min(100, Math.round(a.characterCount / a.characterLimit * 100)) : null;
  body.append(el('div', { className: 'el-summary' },
    el('div', { className: 'row' }, yes('Connected'), el('strong', {}, a?.name || 'ElevenLabs account'), a?.tier && el('span', { className: 'muted' }, a.tier)),
    pct !== null && el('div', { className: 'credit' }, el('div', { className: `bar${pct >= 80 ? ' low' : ''}`, role: 'img', 'aria-label': `${pct}% of credits used` }, el('i', { style: `width:${pct}%` })), el('span', { className: pct >= 80 ? 'low-text' : 'muted' }, `${credits}${pct >= 80 ? ' · running low' : ''}`))));
  body.append(el('details', { className: 'el-details' }, el('summary', { className: 'muted' }, 'Connection details'), el('div', { className: 'status rows' },
    statusRow('Account', a ? yes(a.tier || 'Connected') : no('Hidden'), a ? [a.name, credits].filter(Boolean).join(' · ') : 'This key may not read account details. That is fine for voiceovers.'),
    statusRow('API key', yes('Accepted'), `Checked with ElevenLabs on ${dateLabel(v.checkedAt || v.connectedAt)}. Stored in your Mac’s Keychain.`),
    statusRow('Voice list', c.voicesRead ? yes('Allowed') : no('Not allowed'), c.voicesRead ? 'Your AI app can suggest voices from your account.' : 'The key cannot list voices. Your AI app will need a voice ID, or create a key that can read voices.'),
    statusRow('Speech', c.speech === 'verified' ? yes('Confirmed') : no('Not yet confirmed'), c.speech === 'verified' ? `First voiceover generated on ${dateLabel(c.speechVerifiedAt)}.` : 'Confirmed by the first voiceover. Checking it here would cost credits.'),
    statusRow('Preferred voice', v.preferredVoice ? yes('Set') : no('Not chosen'), v.preferredVoice ? `${v.preferredVoice.name || 'Unnamed voice'} · ${v.model}` : 'Describe the voice you want to your AI app; it will suggest a few to choose from.'))));
  const actions = el('div', { className: 'row' });
  if (voice.confirmDisconnect) actions.append(el('span', {}, 'Remove the key from this Mac?'),
    el('button', { className: 'primary', disabled: voice.busy, onClick: async () => { voice.busy = true; render(); try { state.voiceover = await post('/api/voiceover/disconnect', {}); message('ElevenLabs disconnected. The key was removed from your Keychain.'); } catch (error) { voice.error = error.message; } voice.busy = false; voice.confirmDisconnect = false; render(); } }, 'Disconnect'),
    el('button', { className: 'ghost', onClick: () => { voice.confirmDisconnect = false; render(); } }, 'Keep it'));
  else actions.append(el('button', { className: 'ghost', onClick: () => { voice.editing = true; voice.error = null; render(); } }, 'Change key'),
    el('button', { className: 'ghost', onClick: () => { voice.confirmDisconnect = true; render(); } }, 'Disconnect'),
    el('a', { href: 'https://elevenlabs.io/app/usage', target: '_blank', rel: 'noopener noreferrer', className: 'muted' }, 'Usage on ElevenLabs ↗'));
  body.append(actions, errorLine, el('h3', { style: 'margin-top:4px' }, 'Try it in your AI app'), copyBlock(voiceExample, 'Copy example request'));
  return panel;
}

const navSvg = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  brand: '<circle cx="8" cy="9" r="3.2"/><circle cx="16" cy="9" r="3.2"/><circle cx="12" cy="15.5" r="3.2"/>',
  setup: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
};
// Sidebar: Overview, then the workspace's projects as a tree (each project opens to its videos), then Brand and Setup.
function buildNav() {
  const nav = $('#nav'); if (!nav) return;
  const link = (label, hash, { icon, active, className = '', title, after } = {}) => el('a', { className: `navlink ${className}${active ? ' active' : ''}`, href: hash, title, 'aria-current': active ? 'page' : null }, icon && svgIcon(navSvg[icon]), el('span', { className: 'navtext' }, label), after);
  const dot = status => el('i', { className: `dot ${status === 'raw' ? 'idle' : status}`, title: { review: 'Waiting for your review', finished: 'Finished', raw: 'Not edited yet' }[status] });
  const tree = state.projects.map(group => {
    const list = state.videos.filter(v => v.project === group.name);
    const inside = route.project === group.name;
    const box = el('details', { className: 'navgroup', open: inside || openGroups.has(group.name) },
      el('summary', {}, el('a', { href: `#project/${encodeURIComponent(group.name)}`, className: `grouplink${route.name === 'project' && inside ? ' active' : ''}` }, group.title), el('span', { className: 'count' }, String(list.length))),
      el('div', { className: 'navvideos' }, list.map(v => link(v.name, `#${videoPath('video', v)}`, { className: 'sub', active: ['video', 'plan'].includes(route.name) && inside && route.video === v.name, after: dot(videoStatus(v)) }))));
    box.addEventListener('toggle', () => { if (box.open) openGroups.add(group.name); else openGroups.delete(group.name); });
    return box;
  });
  nav.replaceChildren(link('Overview', '#overview', { icon: 'overview', active: route.name === 'overview' }),
    el('span', { className: 'navlabel' }, 'Projects'), ...(tree.length ? tree : [el('p', { className: 'navempty' }, 'No projects yet. Your AI app creates one with your first video.')]),
    el('span', { className: 'navlabel spaced' }, 'Workspace'), link('Brand', '#brand', { icon: 'brand', active: route.name === 'brand' }), link('Setup & preferences', '#setup', { icon: 'setup', active: route.name === 'setup' }));
}
function buildCrumb() {
  const parts = [[ 'Overview', '#overview' ]];
  const group = route.project && currentGroup();
  if (['project', 'video', 'plan'].includes(route.name)) parts.push([group?.title || route.project, route.name === 'project' ? null : `#project/${encodeURIComponent(route.project)}`]);
  if (['video', 'plan'].includes(route.name)) parts.push([route.video, route.name === 'plan' ? `#video/${encodeURIComponent(route.project)}/${encodeURIComponent(route.video)}` : null]);
  if (route.name === 'plan') parts.push(['Plan', null]);
  if (route.name === 'brand') parts[0] = ['Brand', null]; if (route.name === 'setup') parts[0] = ['Setup & preferences', null];
  $('#crumb').replaceChildren(...parts.flatMap(([label, href], i) => [i ? el('span', { className: 'sep', 'aria-hidden': 'true' }, '›') : null, href ? el('a', { href }, label) : el('span', { className: 'here', 'aria-current': 'page' }, label)].filter(Boolean)));
}
const pageTitle = () => route.name === 'video' || route.name === 'plan' ? route.video : route.name === 'project' ? (currentGroup()?.title || route.project) : TABS[route.name] || 'Overview';
function render() {
  main.replaceChildren();
  buildNav(); buildCrumb();
  $('#brand-name').textContent = wsName() || 'Video companion';
  $('#brand-sub').textContent = 'Local · read-only';
  document.title = `${wsName() ? `${wsName()} · ` : ''}${pageTitle()}`;
  $('#notice').hidden = route.name !== 'setup' || storageGet(`notice:${state.root}`) === 'seen';
  try { if (route.name === 'setup') setupView(); else if (route.name === 'video') videoPage(); else if (route.name === 'plan') planView(); else if (route.name === 'project') projectView(); else if (route.name === 'brand') brandView(); else overviewView(); }
  catch (error) { main.append(el('p', { className: 'error' }, `Something went wrong showing this page: ${error.message}`)); }
  window.scrollTo(0, 0);
}
function navigate(next) { goto(next); }
function fromHash() { parseHash(); }
async function reloadState() {
  state = await api('/api/state');
  render();
}
let lastLoad = Date.now();
// Picks up new files when you come back to this tab; skips the redraw while you are typing so nothing you wrote is lost.
async function quietReload() {
  if (!state || Date.now() - lastLoad < 8000) return; lastLoad = Date.now();
  try {
    const next = await api('/api/state');
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    const typing = document.activeElement?.matches?.('input, textarea') && document.activeElement.value;
    if (!typing) render();
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) quietReload(); });
window.addEventListener('focus', quietReload);
window.addEventListener('hashchange', () => { fromHash(); if (state) render(); });
$('#refresh').addEventListener('click', async () => { try { await reloadState(); message('Files refreshed from disk.'); } catch (error) { message(`Refresh failed: ${error.message}`, true); } });
try {
  state = await api('/api/state');
  fromHash();
  $('#folder').textContent = state.root;
  $('#dismiss').addEventListener('click', () => { storageSet(`notice:${state.root}`, 'seen'); $('#notice').hidden = true; });
  render();
} catch (error) { main.replaceChildren(el('h1', {}, 'Could not read the local workspace'), el('p', { className: 'error' }, error.message), el('p', {}, 'Ask your AI app to inspect the app and its folder paths.')); }
