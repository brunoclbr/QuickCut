const $ = selector => document.querySelector(selector);
const main = $('#main');
const TABS = { videos: '01 / Videos', workspace: '02 / Workspace', brand: '03 / Brand', setup: '04 / Setup & preferences' };
let state, tab = 'videos', currentProject, selectedDraft, statusTimer;
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

const readRules = 'Read AGENTS.md, system/editing-brain.md, workspace/preferences/editing-guide.md, workspace/preferences/editing-rules.md, workspace/assets/asset-index.md and system/setup/setup-notes.md. Reuse saved preferences; ask only about missing material decisions or conflicts. Preserve originals, real voice, meaning and appearance. Never silently substitute assets or convert HDR to SDR.';
const updateText = 'Update QuickCut to the latest version from GitHub with git pull. First run git status and tell me about any local changes; never discard, overwrite or move anything in workspace/ (my videos, preferences and assets). If the pull would conflict, stop and explain. Afterwards tell me in plain words what changed, and run npm --prefix system/app test.';
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
  return `${readRules}\nI put a new video in ${state.dropFolder}/: ${file.name}. Start a new video project for it. Suggest a short project name and confirm it with me, then create workspace/videos/<name>/ with brief.md, feedback.md, source/, drafts/ and work/, and move the file unchanged into source/ (move, do not copy or re-encode). Leave a note in the drop folder saying where it went. Do not overwrite existing projects. Ask only for missing video-specific decisions. When inputs are ready, create a numbered playable 15-second opening and wait for my review before extending it. No publishing.`;
}
function sourceStatus(project) {
  if (!project.sourceExists) return 'No source folder';
  return project.source.length ? `${project.source.length} file${project.source.length === 1 ? '' : 's'}` : 'Empty';
}
function openProject(name) { currentProject = name; selectedDraft = null; navigate('workspace'); }

function folderRow(icon, name, relative, what, extra) {
  return el('div', { className: 'frow' }, svgIcon(icons[icon]), el('div', {}, el('span', { className: 'name' }, name), what && el('p', { className: 'what' }, what)), el('span', { className: 'where mono', title: fullPath(relative) }, `…/${relative}/`), el('div', { className: 'row' }, extra, revealButton(relative), copyPathButton(relative)));
}
// The newest numbered draft (draft-NN…, most recently written); calibration samples and other files don't count.
const latestDraft = project => { const numbered = project.drafts.filter(d => /^draft-\d+/i.test(d.name)); return (numbered.length ? numbered : project.drafts).slice().sort((a, b) => a.modified.localeCompare(b.modified)).at(-1); };
const needsApproval = project => Boolean(latestDraft(project)) && latestDraft(project).path !== project.approved;
function sayRow(say, what, text) { return el('div', { className: 'say' }, el('div', {}, el('strong', {}, `“${say}”`), el('p', { className: 'muted' }, what)), text && el('button', { className: 'ghost', onClick: () => copy(text) }, 'Copy instruction')); }
function videosView() {
  main.append(head('Your videos', 'Everything here is a file on your Mac. Your AI app makes and changes them; this page shows what exists and where it is.'));

  // 1. Finished videos: the results, first.
  const done = el('div', { className: 'block' }, el('span', { className: 'label' }, `Finished videos · ${state.finishedVideos.length}`));
  if (!state.finishedVideos.length) done.append(el('div', { className: 'panel empty' }, 'Nothing finished yet. When you approve a draft, your AI app copies it here.'));
  else done.append(el('div', { className: 'finished-grid' }, state.finishedVideos.map(f => {
    const project = state.projects.find(p => p.name === stem(f.name));
    return el('div', { className: 'fcard' },
      el('video', { controls: true, playsInline: true, preload: 'metadata', src: mediaURL(f.path) }),
      el('div', { className: 'fbody' },
        el('h2', {}, stem(f.name)),
        el('p', { className: 'muted' }, `${sizeLabel(f.bytes)} · ${dateLabel(f.modified)}${project?.approved ? ` · approved ${stem(project.approved.split('/').at(-1))}` : ''}`),
        el('div', { className: 'row' }, revealButton(f.path), el('a', { className: 'btn', href: mediaURL(f.path), download: f.name }, 'Download'), copyPathButton(f.path))));
  })));
  main.append(done);

  // 2. Projects.
  const block = el('div', { className: 'block' }, el('span', { className: 'label' }, `Projects · ${state.projects.length}`));
  if (!state.projects.length) block.append(el('div', { className: 'panel empty' }, 'No projects yet. Tell your AI app about a new video (see “Where things are” below).'));
  else {
    const grid = el('div', { className: 'project-grid' });
    state.projects.forEach((project, i) => {
      const latest = latestDraft(project);
      const updated = [...project.drafts, ...project.source].map(f => f.modified).sort().at(-1);
      grid.append(el('button', { className: 'project', onClick: () => openProject(project.name), 'aria-label': `Open ${project.name}` },
        el('div', { className: 'row between' }, el('span', { className: 'mono muted' }, pad(i + 1)), needsApproval(project) ? el('span', { className: 'tag on' }, project.approved ? 'Newer draft not approved' : 'Not approved yet') : el('span', { className: 'tag ok' }, 'Approved')),
        el('h2', {}, project.name),
        el('div', { className: 'stats' },
          el('div', { className: 'stat' }, el('span', { className: 'label' }, 'Drafts'), el('b', {}, String(project.drafts.length))),
          el('div', { className: 'stat' }, el('span', { className: 'label' }, 'Source'), el('b', {}, sourceStatus(project))),
          el('div', { className: 'stat' }, el('span', { className: 'label' }, 'Latest'), el('b', { className: 'mono', title: latest?.name || '' }, latest ? stem(latest.name) : '—')),
          el('div', { className: 'stat' }, el('span', { className: 'label' }, 'Updated'), el('b', {}, dateLabel(updated) || '—'))),
        el('span', { className: 'open' }, 'Open workspace →')));
    });
    block.append(grid);
  }
  main.append(block);

  // 3. Where things are (a map, not a to-do list).
  const rows = el('div', { className: 'rows' });
  rows.append(folderRow('done', 'Finished videos', state.finishedFolder, 'Your approved results, one per project.'));
  rows.append(folderRow('folder', 'Projects', state.projectsFolder, 'One folder per video: source/ (your original footage), drafts/ (every version, never overwritten), feedback.md (all review notes).', !state.projectsFolderExists && el('span', { className: 'tag bad' }, 'Missing')));
  rows.append(folderRow('drop', 'New footage (optional)', state.dropFolder, 'Copy a new video here in Finder, or simply tell your AI app where the file is. Either works.', state.newVideos.length ? el('span', { className: 'tag on' }, `${state.newVideos.length} waiting`) : null));
  if (state.newVideos.length) rows.append(el('div', { className: 'subrow' }, state.newVideos.map(file => el('div', { className: 'item' }, el('span', {}, el('strong', {}, file.name), el('span', { className: 'muted' }, ` · ${sizeLabel(file.bytes)}`)), el('button', { className: 'primary', onClick: () => copy(newVideoPrompt(file)) }, 'Copy start instruction')))));
  rows.append(el('div', { className: 'frow' }, svgIcon(icons.lock), el('div', {}, el('span', { className: 'name' }, 'system/'), el('p', { className: 'what' }, 'QuickCut’s own machinery. Don’t edit, move or delete anything here; ask your AI app instead.')), el('span', { className: 'where mono', title: fullPath('system') }, '…/system/'), el('span', { className: 'tag' }, 'Don’t touch')));
  main.append(el('div', { className: 'block' }, el('span', { className: 'label' }, 'Where things are'), el('p', { className: 'root-line' }, 'Your QuickCut folder: ', el('span', { className: 'mono' }, state.root), ' — “…” below stands for it.'), rows));

  // 4. Things to say to your AI app.
  main.append(el('div', { className: 'block' }, el('span', { className: 'label' }, 'Things you can say to your AI app'), el('div', { className: 'panel says' },
    sayRow('Open the app', 'Opens this companion.'),
    sayRow('Open the editor app', 'Opens HyperFrames Studio, where you can tweak a video by hand. Afterwards, tell your AI app what you changed: its next build rewrites the file, so your edits must be carried over.', studioText),
    sayRow('Approve draft 07 of my-video', 'Records the approval and copies that draft to Finished videos. Until you do, the newest draft is not your final video.'),
    sayRow('Update QuickCut', 'Gets the latest version of this app and its tools (git pull), without touching your videos. Worth doing every now and then.', updateText))));
}

function approvalTextFor(project, draft) {
  const relative = draft.path.slice(project.folder.length + 1);
  return `I watched all of ${draft.path} with sound and approve it as the accepted version of ${project.name}. Append this to ${project.folder}/feedback.md, keeping the first two lines exactly as written:\n## Approved version\nDraft: ${relative}\nApproved by the owner on <today's date> after a full review.\nThen copy it to workspace/finished-videos/${project.name}.mp4. Do not re-render, change the video or promote anything to my reusable style.`;
}
function workspaceView() {
  if (!state.projects.length) { main.append(head('No project yet', 'Projects appear here after your AI app starts one.'), el('div', { className: 'panel empty' }, 'Go to Videos to see the drop folder.')); return; }
  const project = state.projects.find(p => p.name === currentProject) || state.projects[0];
  currentProject = project.name;
  $('#crumb').textContent = `${TABS.workspace} · ${project.name}`;
  const draft = project.drafts.find(d => d.path === selectedDraft) || project.drafts.find(d => d.path === project.approved) || project.drafts.at(-1);
  selectedDraft = draft?.path;

  const switcher = state.projects.length > 1 && el('label', { className: 'picker' }, el('span', { className: 'label' }, 'Select your project'), el('select', { onChange: e => openProject(e.target.value) }, state.projects.map(p => el('option', { value: p.name, selected: p.name === project.name }, p.name))));
  main.append(el('div', { className: 'ws-head' },
    el('div', {}, el('h1', {}, project.name), el('p', { className: 'lede' }, 'Review drafts, compare versions, and continue working in Codex.')),
    el('div', { className: 'row', style: 'align-items:flex-end' }, el('button', { className: 'ghost', onClick: () => navigate('videos') }, '← All projects'), switcher)));

  if (needsApproval(project)) {
    const latest = latestDraft(project);
    main.append(el('div', { className: 'nudge', role: 'note' },
      el('div', {}, el('strong', {}, `${stem(latest.name)} is not approved yet.`), el('span', {}, project.approved ? ' Your finished video is still an older draft. ' : ' Nothing is in Finished videos yet. ', 'Happy with it? Approve it so it becomes your finished video.')),
      el('button', { className: 'primary', onClick: () => copy(approvalTextFor(project, latest)) }, `Copy approval of ${stem(latest.name)}`)));
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
    meta.append(kv('Draft', draft.name), kv('Duration', '…', 'meta-duration'), kv('Resolution', '…', 'meta-resolution'), kv('Format', draft.name.split('.').pop().toUpperCase()), kv('Size', sizeLabel(draft.bytes)), kv('Exported', dateLabel(draft.modified)),
      el('div', { className: 'actions' }, revealButton(draft.path), el('a', { className: 'btn', href: mediaURL(draft.path), download: draft.name }, 'Download'), copyPathButton(draft.path)));
  } else {
    stage.append(el('div', { className: 'stage-msg', style: 'position:static' }, 'No exports yet. Ask your AI app for a playable opening draft, not just a plan.'));
  }

  // Right: drafts, approval, feedback.
  const side = el('div', { className: 'side' });
  const list = el('div', { className: 'drafts', role: 'list' });
  project.drafts.forEach((d, i) => list.append(el('button', { role: 'listitem', 'aria-current': String(d.path === draft?.path), onClick: () => { selectedDraft = d.path; render(); } },
    el('span', { className: 'n' }, pad(i + 1)), el('span', { className: 't' }, stem(d.name)), d.path === project.approved ? el('span', { className: 'tag on' }, 'Approved') : el('span'),
    el('span', { className: 's' }, `${dateLabel(d.modified)} · ${sizeLabel(d.bytes)}`))));
  side.append(el('section', {}, el('div', { className: 'row between' }, el('span', { className: 'label' }, 'Drafts'), el('span', { className: 'mono muted' }, String(project.drafts.length))), project.drafts.length ? list : el('p', { className: 'muted', style: 'margin:10px 0 0' }, 'No drafts in drafts/ yet.')));
  if (draft) {
    const approvalText = approvalTextFor(project, draft);
    side.append(el('section', {}, el('span', { className: 'label' }, 'Approval'), el('div', { style: 'margin-top:10px' },
      draft.path === project.approved ? el('p', { style: 'margin:0' }, el('span', { className: 'tag on' }, 'Approved version'), el('span', { className: 'muted' }, ' · copied to finished-videos by your AI app'))
        : copyBlock(approvalText, 'Copy approval for Codex', project.approved ? 'Replaces the current approval' : null))));
  }
  const stamp = el('input', { placeholder: '00:08–00:12', 'aria-label': 'Timestamp' });
  const change = el('textarea', { rows: 4, placeholder: 'What should change? What must stay the same?', 'aria-label': 'Feedback' });
  const feedbackText = () => `${readRules}\nProject: ${project.name}\nDraft: ${draft ? draft.path : '(none yet — prepare a numbered 15-second opening once inputs are ready)'}\n\nFeedback${stamp.value ? ` at ${stamp.value}` : ''}:\n${change.value || '[describe the change and what must stay unchanged]'}\n\nRecord these notes in ${project.folder}/feedback.md. Preserve approved elements; save a new numbered draft without overwriting previous versions. Explain any timing impact. Hand me a playable MP4 and report unresolved limitations.`;
  side.append(el('section', {}, el('span', { className: 'label' }, 'Feedback for Codex'),
    el('label', { className: 'field' }, el('span', {}, 'Timestamp (optional)'), stamp),
    el('label', { className: 'field' }, el('span', {}, 'What should change'), change),
    el('div', { className: 'row', style: 'margin-top:12px' }, el('button', { className: 'primary', onClick: () => copy(feedbackText()) }, 'Copy feedback for Codex'), el('span', { className: 'muted' }, 'Paste it in your Codex chat.')),
    el('details', { className: 'tip' }, el('summary', {}, 'Long or messy notes? Polish them first'),
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
    fold('Next step: extend to the full video', 'instruction', copyBlock(fullEdit, 'Copy instruction for Codex', 'Use after the opening is approved.'))));
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
  // Colours: the guide's "## Colour" section if it has one, otherwise its "Color:" / "Palette:" lines.
  const colour = section('Colou?r') || (text.match(/^(?:Colou?r|Palette)[^:\n]*:.*$/gim) || []).join('\n');
  const palette = [...colour.matchAll(/([A-Za-z][A-Za-z-]*(?: [A-Za-z-]+)?) \(?(#[0-9A-Fa-f]{6})/g)].map(m => ({ name: m[1][0].toUpperCase() + m[1].slice(1), hex: m[2].toUpperCase() }))
    .filter((p, i, all) => all.findIndex(q => q.hex === p.hex) === i);
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const byLight = palette.slice().sort((a, b) => lum(a.hex) - lum(b.hex));
  const named = re => palette.find(p => re.test(p.name))?.hex;
  const dark = byLight[0]?.hex, light = byLight.at(-1)?.hex;
  const accent = named(/accent|highlight|brand|sand/i) || byLight[Math.floor(byLight.length / 2)]?.hex;
  const capBox = /Caption box[^#\n]*(#[0-9A-Fa-f]{6})/i.exec(text)?.[1], highlight = /highlight[^#\n]*(#[0-9A-Fa-f]{6})/i.exec(text)?.[1];
  const fonts = section('Fonts and lettering').split('\n').filter(l => /^(Title font|Spoken-caption font|Accent font)[^:]*: *\S/.test(l));
  const reference = /(workspace\/finished-videos\/[^\s(),]+\.mp4)/.exec(text)?.[1];
  const identity = /^Visual identity[^:]*: *(\S.*)$/m.exec(text)?.[1];
  return { palette, dark, light, accent, capBox, highlight, fonts, reference, identity };
}
function brandView() {
  main.append(head('Your brand', 'How your videos look, shown from your editing guide. To change it, tell your AI app.'));
  const box = el('div', {}, el('p', { className: 'muted' }, 'Reading your editing guide…'));
  main.append(box);
  api('/api/document?path=workspace%2Fpreferences%2Fediting-guide.md').then(({ content }) => {
    const b = brandFromGuide(content);
    if (!b.palette.length) { box.replaceChildren(el('div', { className: 'panel empty' }, 'Your editing guide has no colour palette yet. Ask your AI app to record your brand colours in workspace/preferences/editing-guide.md.')); return; }
    const paint = (node, styles) => { Object.assign(node.style, styles); return node; };
    const dark = b.dark, light = b.light, accent = b.accent || light;
    const swatches = el('div', { className: 'swatches' }, b.palette.map(p => el('div', { className: 'swatch' }, paint(el('i'), { background: p.hex }), el('b', {}, p.name), el('span', { className: 'mono muted' }, p.hex))));
    const title = paint(el('div', { className: 'specimen' }),
      { background: dark, color: light });
    title.append(paint(el('span', { className: 'eyebrow' }), { color: accent }), el('div', { className: 'h-sans' }, 'Your headline.'), paint(el('div', { className: 'h-serif' }, 'A second line.'), { color: accent }));
    title.firstChild.textContent = '01 / Section title';
    const caption = paint(el('div', { className: 'cap-stage' }), { background: '#cfcac3' });
    const cap = paint(el('div', { className: 'cap-box' }), { background: b.capBox || dark, color: light });
    ['Captions', 'follow', 'your', 'voice.'].forEach(w => cap.append(w === 'your' ? paint(el('span', { className: 'hl' }, w), { background: b.highlight || accent, color: dark }) : el('span', {}, w)));
    caption.append(cap);
    const card = paint(el('div', { className: 'card-sample' }), { background: light, color: dark });
    card.append(paint(el('span', { className: 'clabel' }, 'Card label'), { color: dark }), el('div', { className: 'shot' }, el('i'), el('i'), el('i')), paint(el('div', { className: 'cfoot' }, 'A short takeaway.'), { color: dark }));
    const cardStage = paint(el('div', { className: 'card-stage' }), { background: dark }); cardStage.append(card);
    box.replaceChildren(
      b.identity && inline(b.identity, el('p', { className: 'identity' })),
      el('div', { className: 'block' }, el('span', { className: 'label' }, 'Palette'), swatches),
      el('div', { className: 'block' }, el('span', { className: 'label' }, 'Type, captions and cards'), el('div', { className: 'brand-grid' },
        el('figure', {}, title, el('figcaption', { className: 'muted' }, 'Section eyebrow, bold sans headline, italic serif second line.')),
        el('figure', {}, caption, el('figcaption', { className: 'muted' }, 'Captions: the phrase, with the spoken word highlighted.')),
        el('figure', {}, cardStage, el('figcaption', { className: 'muted' }, 'Cards: label, the cropped screenshot, an italic footer.')))),
      b.fonts.length && el('div', { className: 'block' }, el('span', { className: 'label' }, 'Fonts'), el('div', { className: 'panel panel-body doc' }, b.fonts.map(f => inline(f, el('p'))))),
      b.reference && el('div', { className: 'block' }, el('span', { className: 'label' }, 'Reference video'), el('div', { className: 'ref' }, el('video', { controls: true, playsInline: true, preload: 'metadata', src: mediaURL(b.reference) }), el('div', { className: 'stack' }, el('p', {}, 'The approved edit your brand comes from.'), el('div', { className: 'row' }, revealButton(b.reference), copyPathButton(b.reference))))),
      el('p', { className: 'muted', style: 'margin-top:24px' }, 'Shown from workspace/preferences/editing-guide.md. These are browser previews in standard colour; videos rendered in HDR show the same colours.'));
  }).catch(error => box.replaceChildren(el('p', { className: 'error' }, `Could not read your editing guide: ${error.message}`)));
}
function statusRow(name, tag, detail) { return [el('div', {}, el('strong', {}, name)), el('div', { className: 'detail' }, detail || ''), el('div', {}, tag)]; }
function setupView() {
  main.append(el('div', { className: 'setup-head' }, head('Setup & preferences', 'Configure your editing environment and manage resources.'),
    el('div', { className: 'disclaimer', role: 'note' }, el('strong', {}, 'This page only shows what Codex or Claude has set up.'), el('span', {}, 'To change any setting, ask them in the chat. The only things this app does itself: saving your ElevenLabs key (so it never goes through the chat) and Show in Finder.'))));
  const lib = state.library;
  const manualMissing = lib ? lib.sources.filter(s => s.acquisition === 'manual' && !s.installed) : [];
  const toolRow = (name, probe) => !tools.checked ? statusRow(name, el('span', { className: 'tag' }, 'Not checked'), 'Click “Check tools” to look.')
    : tools.error ? statusRow(name, el('span', { className: 'tag bad' }, 'Error'), tools.error)
    : probe.detected ? statusRow(name, el('span', { className: 'tag ok' }, 'Available'), probe.version) : statusRow(name, el('span', { className: 'tag bad' }, 'Missing'), 'Not found. Ask your AI app to set it up.');
  const status = el('div', { className: 'status' },
    statusRow('Project folder', state.projectsFolderExists ? el('span', { className: 'tag ok' }, 'Found') : el('span', { className: 'tag bad' }, 'Missing'), el('span', { className: 'mono', title: fullPath(state.projectsFolder) }, `${state.projectsFolder}/`)),
    statusRow('Asset library', !lib ? el('span', { className: 'tag' }, 'Unavailable') : lib.available ? el('span', { className: 'tag ok' }, 'Ready') : el('span', { className: 'tag bad' }, 'Not set up'),
      !lib ? 'Could not read system/assets/catalog.json.' : lib.available ? `${lib.available} of ${lib.catalogued} catalogued assets installed${manualMissing.length ? ` · ${manualMissing.length} optional packs not downloaded` : ''}` : 'Tell your AI app: “Set up the asset library.”'),
    toolRow('Node.js', tools.result && { detected: true, version: tools.result.node }),
    toolRow('FFmpeg', tools.result?.ffmpeg),
    toolRow('Whisper', tools.result?.whisper));
  const check = el('button', { className: 'ghost', onClick: async () => { check.disabled = true; try { tools.result = await api('/api/tools'); tools.error = null; } catch (error) { tools.error = error.message; } tools.checked = true; render(); } }, tools.checked ? 'Check again' : 'Check tools');
  main.append(el('div', { className: 'panel' }, el('div', { className: 'panel-head' }, el('h2', {}, 'System status'), check), status,
    tools.checked && !tools.error && el('p', { className: 'muted', style: 'margin:0;padding:10px 18px;border-top:1px solid var(--line);font-size:13px' }, 'Detection only. A playable test made by your AI app is what proves setup works.')));

  const repo = state.repo;
  main.append(el('section', { className: 'panel' }, el('div', { className: 'panel-head' }, el('div', {}, el('h2', {}, 'Keep QuickCut up to date'), el('p', { className: 'muted', style: 'margin:2px 0 0;font-size:13.5px' }, 'The app and its tools get improvements every now and then. Your videos, preferences and assets are never touched by an update.')), el('span', { className: 'tag' }, repo?.lastChanged ? `Last changed ${dateLabel(repo.lastChanged)}` : 'Not a git copy')),
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
    return selected.length ? `${readRules}\n${scope.value === 'guide' ? 'These are proposed reusable preferences. Reconcile them with the current guide; ask about conflicts before changing approved choices. Save agreed preferences in workspace/preferences/editing-guide.md.' : currentProject ? `These choices apply only to workspace/videos/${currentProject}. Read its brief and feedback. Save agreed choices in this video’s brief; do not promote them to universal defaults.` : 'These choices apply to one video only. Ask me which project before saving them.'}\n${selected.join('\n')}\nThese UI illustrations do not approve a font, exact size, color or asset. Preserve other approved elements. Do not render until I request a draft.` : '';
  };
  const copyChoices = el('button', { className: 'primary', onClick: () => copy(promptText()) }, 'Copy choices for Codex');
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
    if (!v.sdkInstalled) body.append(el('div', { className: 'stack' }, el('p', { className: 'error' }, 'The voiceover tools are not installed yet.'), copyBlock('Install the voiceover tools (npm --prefix system/voiceover ci) and tell me when the ElevenLabs Connect button is ready.', 'Copy instruction for Codex')));
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
  body.append(el('div', { className: 'status rows' },
    statusRow('Account', a ? yes(a.tier || 'Connected') : no('Hidden'), a ? [a.name, credits].filter(Boolean).join(' · ') : 'This key may not read account details. That is fine for voiceovers.'),
    statusRow('API key', yes('Accepted'), `Checked with ElevenLabs on ${dateLabel(v.checkedAt || v.connectedAt)}. Stored in your Mac’s Keychain.`),
    statusRow('Voice list', c.voicesRead ? yes('Allowed') : no('Not allowed'), c.voicesRead ? 'Your AI app can suggest voices from your account.' : 'The key cannot list voices. Your AI app will need a voice ID, or create a key that can read voices.'),
    statusRow('Speech', c.speech === 'verified' ? yes('Confirmed') : no('Not yet confirmed'), c.speech === 'verified' ? `First voiceover generated on ${dateLabel(c.speechVerifiedAt)}.` : 'Confirmed by the first voiceover. Checking it here would cost credits.'),
    statusRow('Preferred voice', v.preferredVoice ? yes('Set') : no('Not chosen'), v.preferredVoice ? `${v.preferredVoice.name || 'Unnamed voice'} · ${v.model}` : 'Describe the voice you want to your AI app; it will suggest a few to choose from.')));
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

function render() {
  main.replaceChildren();
  $('#crumb').textContent = TABS[tab];
  document.querySelectorAll('[data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  try { if (tab === 'setup') setupView(); else if (tab === 'workspace') workspaceView(); else if (tab === 'brand') brandView(); else videosView(); }
  catch (error) { main.append(el('p', { className: 'error' }, `Something went wrong showing this page: ${error.message}`)); }
  if (currentProject) storageSet(`project:${state.root}`, currentProject);
  window.scrollTo(0, 0);
}
function navigate(next) { if (location.hash.slice(1) === next) render(); else location.hash = next; }
function fromHash() { const h = location.hash.slice(1); tab = h in TABS ? h : 'videos'; }
async function reloadState() {
  state = await api('/api/state');
  if (currentProject && !state.projects.some(p => p.name === currentProject)) { currentProject = null; selectedDraft = null; }
  render();
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.tab)));
window.addEventListener('hashchange', () => { fromHash(); if (state) render(); });
$('#refresh').addEventListener('click', async () => { try { await reloadState(); message('Files refreshed from disk.'); } catch (error) { message(`Refresh failed: ${error.message}`, true); } });
try {
  state = await api('/api/state');
  currentProject = storageGet(`project:${state.root}`) || state.projects[0]?.name;
  fromHash();
  $('#folder').textContent = state.root;
  $('#notice').hidden = storageGet(`notice:${state.root}`) === 'seen';
  $('#dismiss').addEventListener('click', () => { storageSet(`notice:${state.root}`, 'seen'); $('#notice').hidden = true; });
  render();
} catch (error) { main.replaceChildren(el('h1', {}, 'Could not read the local workspace'), el('p', { className: 'error' }, error.message), el('p', {}, 'Ask your AI app to inspect the app and its folder paths.')); }
