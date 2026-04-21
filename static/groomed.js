/* Phase 12 — Requirements → Groomed Backlog → Jira (frontend)
   All user-data interpolation uses the esc() helper which delegates to
   window.escapeHTML. innerHTML is used only for static template scaffolds,
   identical pattern to the Phase 6-10 features in script.js. */
(function(){
  'use strict';
  const groomedState = {
    projectId: null,
    tree: null,
    depGraph: null,
    schedule: null,
    criticalPath: [],
    activeView: 'upload',
    currentUpload: null,
    storyBeingEdited: null,
    jiraConfig: null,
    CANONICAL_FIELDS: ['id','description','priority','source','type','notes','acceptance','owner','tags'],
  };
  window._groomedState = groomedState;
  const $g = (id) => document.getElementById(id);
  const esc = (s) => (window.escapeHTML ? window.escapeHTML(String(s || ''))
                      : String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const setHTML = (el, html) => { if (el) el.innerHTML = html; };
  function setStatus(msg, kind) {
    const el = $g('groomed-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('is-error','is-success','is-busy');
    if (kind) el.classList.add('is-' + kind);
  }
  function switchGroomedView(view) {
    groomedState.activeView = view;
    document.querySelectorAll('.groomed-view-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.groomedView === view);
    });
    document.querySelectorAll('.groomed-view-panel').forEach(p => {
      const match = p.dataset.groomedView === view;
      p.classList.toggle('hidden', !match);
      p.classList.toggle('active', match);
    });
    if (groomedState.projectId) {
      if (view === 'tree' || view === 'mentor') refreshBacklogTree();
      if (view === 'deps') refreshDepsGraph();
      if (view === 'schedule') recomputeSchedule();
    }
  }

  // Upload + mapping + grooming SSE stream
  async function handleFileSelected(file) {
    if (!file) return;
    if (!groomedState.projectId) { setStatus('Select a project first.', 'error'); return; }
    setStatus('Uploading ' + file.name + '...', 'busy');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/requirements/upload', {method:'POST', body: form});
      if (!res.ok) {
        const err = await res.json().catch(() => ({detail: res.statusText}));
        setStatus('Upload failed: ' + (err.detail || res.statusText), 'error');
        return;
      }
      const data = await res.json();
      groomedState.currentUpload = data;
      renderMappingPreview(data);
      setStatus('Parsed ' + data.parse.rows + ' row(s) · mapping confidence: ' + data.mapping.confidence, 'success');
      await refreshUploads();
    } catch (e) { setStatus('Upload error: ' + e, 'error'); }
  }

  function renderMappingPreview(data) {
    const wrap = $g('groomed-mapping-preview');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    $g('groomed-mapping-reasoning').textContent =
      (data.mapping.source === 'autodetect' ? 'LLM auto-detected' : 'Heuristic fallback') + ' · ' + data.mapping.reasoning;
    const tbody = $g('groomed-mapping-rows');
    tbody.textContent = '';
    const columns = data.parse.columns || [];
    groomedState.CANONICAL_FIELDS.forEach(canon => {
      const tr = document.createElement('tr');
      const currentSource = data.mapping.mapping[canon] || '';
      const td1 = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = canon;
      td1.appendChild(strong);
      if (canon === 'description') {
        const hint = document.createElement('span');
        hint.className = 'muted-text text-sm';
        hint.textContent = ' (required)';
        td1.appendChild(hint);
      }
      const td2 = document.createElement('td');
      const sel = document.createElement('select');
      sel.className = 'theme-input';
      sel.dataset.canon = canon;
      const optNone = document.createElement('option');
      optNone.value = ''; optNone.textContent = '— unmapped —';
      sel.appendChild(optNone);
      columns.forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        if (c === currentSource) o.selected = true;
        sel.appendChild(o);
      });
      td2.appendChild(sel);
      const td3 = document.createElement('td');
      if (canon === 'description' && !currentSource) {
        const warn = document.createElement('span');
        warn.className = 'badge badge-warn';
        warn.textContent = 'missing';
        td3.appendChild(warn);
      }
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tbody.appendChild(tr);
    });
    const unmappedEl = $g('groomed-unmapped');
    unmappedEl.textContent = '';
    const um = data.mapping.unmapped_sources || [];
    if (um.length) {
      const strong = document.createElement('strong');
      strong.textContent = 'Unmapped source columns: ';
      unmappedEl.appendChild(strong);
      um.forEach((u, i) => {
        const code = document.createElement('code');
        code.textContent = u;
        unmappedEl.appendChild(code);
        if (i < um.length - 1) unmappedEl.appendChild(document.createTextNode(', '));
      });
    }
  }

  async function persistMappingEdits() {
    if (!groomedState.currentUpload) return false;
    const mapping = {};
    document.querySelectorAll('#groomed-mapping-rows select').forEach(sel => {
      if (sel.value) mapping[sel.dataset.canon] = sel.value;
    });
    if (!mapping.description) {
      setStatus('Cannot run grooming — description column must be mapped.', 'error');
      return false;
    }
    const upId = groomedState.currentUpload.upload.id;
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/requirements/' + upId + '/mapping', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({mapping}),
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch (e) { setStatus('Failed to save mapping: ' + e, 'error'); return false; }
  }

  async function startGrooming() {
    if (!groomedState.currentUpload) { setStatus('Upload first.', 'error'); return; }
    const ok = await persistMappingEdits();
    if (!ok) return;
    const upId = groomedState.currentUpload.upload.id;
    const devCount = parseInt($g('groomed-dev-count') && $g('groomed-dev-count').value || '3', 10);
    const progWrap = $g('groomed-progress');
    const progStages = $g('groomed-progress-stages');
    const progLog = $g('groomed-progress-log');
    progWrap.classList.remove('hidden');
    progStages.textContent = '';
    progLog.textContent = '';
    const STAGE_LABELS = {
      intake: '1. Intake',
      cluster: '2. Cluster (Sonnet)',
      draft: '3. Draft stories (BA)',
      enrich: '4. Enrich (PM + Architect + Tech Lead + OS2)',
      sequence: '5. Sequence + Mentor prompts',
    };
    const stageEls = {};
    Object.entries(STAGE_LABELS).forEach(function(kv) {
      const k = kv[0], label = kv[1];
      const d = document.createElement('div');
      d.className = 'groomed-stage pending';
      const dot = document.createElement('span');
      dot.className = 'groomed-stage-dot';
      const lbl = document.createElement('span');
      lbl.className = 'groomed-stage-label';
      lbl.textContent = label;
      const msg = document.createElement('span');
      msg.className = 'groomed-stage-msg muted-text text-sm';
      d.appendChild(dot); d.appendChild(lbl); d.appendChild(msg);
      progStages.appendChild(d);
      stageEls[k] = d;
    });
    setStatus('Grooming started.', 'busy');
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/groom', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({upload_id: upId, dev_count: devCount, include_prior_stories: true, include_fleet_findings: true}),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream: true});
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        let evName = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) evName = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!evName || !raw) continue;
            try { handleGroomingEvent(evName, JSON.parse(raw), stageEls, progLog); } catch (e) { console.warn('groom event', e, raw); }
            evName = null;
          }
        }
      }
      setStatus('Grooming complete — switch tabs to see result.', 'success');
      switchGroomedView('tree');
    } catch (e) { setStatus('Grooming failed: ' + e, 'error'); }
  }

  function handleGroomingEvent(evName, data, stageEls, logEl) {
    function logLine(msg) {
      const ts = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'groomed-log-line';
      const time = document.createElement('span');
      time.className = 'muted-text text-sm';
      time.textContent = ts + ' ';
      div.appendChild(time);
      div.appendChild(document.createTextNode(msg));
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
    if (evName === 'grooming_started') {
      logLine('Kicking off — ' + data.total_requirements + ' requirement(s) across ' + data.agents.length + ' agent(s)');
    } else if (evName === 'grooming_stage') {
      const el = stageEls[data.stage];
      if (el) {
        el.classList.remove('pending','running','complete','error');
        el.classList.add(data.status);
        const msgEl = el.querySelector('.groomed-stage-msg');
        if (msgEl) msgEl.textContent = data.message || '';
      }
      logLine('[' + data.stage + '] ' + data.status + ': ' + (data.message || ''));
    } else if (evName === 'grooming_epics') {
      logLine('Clustering produced ' + data.epics.length + ' epic(s)');
    } else if (evName === 'grooming_stories') {
      logLine('Drafted ' + data.stories.length + ' stories for feature: ' + data.feature_title + ' (' + data.progress.current + '/' + data.progress.total + ')');
    } else if (evName === 'grooming_enriched') {
      logLine('Enriched feature: ' + data.feature_key);
    } else if (evName === 'grooming_sequence') {
      logLine('Critical path: ' + data.critical_path_indices.length + ' stories · predicted sprints: ' + data.multi_dev_schedule.predicted_sprint_count);
    } else if (evName === 'grooming_complete') {
      logLine('Complete — ' + data.epic_count + ' epic, ' + data.feature_count + ' feature, ' + data.story_count + ' story');
    } else if (evName === 'grooming_persisted') {
      logLine(data.ok ? 'Backlog persisted to database' : 'Persistence failed: ' + data.error);
    } else if (evName === 'grooming_error') {
      logLine('Error in ' + data.stage + ': ' + data.message);
    }
  }

  async function refreshUploads() {
    if (!groomedState.projectId) return;
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/requirements');
      const list = await res.json();
      const el = $g('groomed-uploads-list');
      if (!el) return;
      el.textContent = '';
      if (!list.length) {
        const li = document.createElement('li');
        li.className = 'muted-text text-sm';
        li.textContent = 'None yet.';
        el.appendChild(li);
        return;
      }
      list.forEach(function(u) {
        const li = document.createElement('li');
        const s = document.createElement('strong');
        s.textContent = u.filename || '(unnamed)';
        li.appendChild(s);
        li.appendChild(document.createTextNode(' · ' + u.row_count + ' rows · conf '));
        const code = document.createElement('code');
        code.textContent = u.mapping_confidence;
        li.appendChild(code);
        li.appendChild(document.createTextNode(' '));
        const btn = document.createElement('button');
        btn.className = 'link-btn';
        btn.textContent = 'Review / Re-groom';
        btn.addEventListener('click', function() { reloadUpload(u.id); });
        li.appendChild(btn);
        el.appendChild(li);
      });
    } catch (e) { console.warn('refreshUploads', e); }
  }

  async function reloadUpload(uploadId) {
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/requirements/' + uploadId);
      const row = await res.json();
      const sd = row.structured_data || {};
      groomedState.currentUpload = {
        upload: row,
        parse: {rows: sd.row_count, columns: sd.columns, warnings: sd.warnings, sheet_names: [], sheet_used: ''},
        mapping: {mapping: sd.column_mapping, confidence: sd.mapping_confidence, unmapped_sources: [], reasoning: 'Re-loaded from earlier upload', source: 'autodetect'},
      };
      renderMappingPreview(groomedState.currentUpload);
      setStatus('Re-loaded upload ' + uploadId + ' — ' + sd.row_count + ' row(s).', 'success');
    } catch (e) { setStatus('Reload failed: ' + e, 'error'); }
  }

  // ===== Hierarchy (Epic - Feature - Story) =====
  async function refreshBacklogTree() {
    if (!groomedState.projectId) return;
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/groomed-backlog');
      groomedState.tree = await res.json();
      renderTree();
      renderMentorList();
      updateSummary();
    } catch (e) { console.warn('refreshBacklogTree', e); }
  }

  function updateSummary() {
    const el = $g('groomed-summary');
    if (!el || !groomedState.tree) return;
    const tree = groomedState.tree;
    const epicCount = (tree.epics || []).length;
    const featureCount = (tree.epics || []).reduce(function(a,e){ return a + (e.features || []).length; }, 0);
    const storyCount = (tree.epics || []).reduce(function(a,e){
      return a + (e.features || []).reduce(function(b,f){ return b + (f.stories || []).length; }, 0) + (e.unparented_stories || []).length;
    }, 0) + (tree.orphans || []).length;
    if (epicCount + storyCount === 0) {
      el.textContent = 'Upload a requirements spreadsheet to begin.';
    } else {
      el.textContent = epicCount + ' epic(s) / ' + featureCount + ' feature(s) / ' + storyCount + ' story(ies)';
    }
  }

  function buildStoryItem(story) {
    const sd = story.structured_data || {};
    const li = document.createElement('li');
    li.className = 'groomed-story-item';
    li.dataset.storyId = story.id;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'groomed-story-title';
    titleSpan.textContent = story.title || 'Untitled';
    li.appendChild(titleSpan);
    const typeSpan = document.createElement('span');
    typeSpan.className = 'groomed-type groomed-type-' + (sd.type || 'story');
    typeSpan.textContent = sd.type || 'story';
    li.appendChild(typeSpan);
    if (sd.priority) {
      const priSpan = document.createElement('span');
      const priKey = (sd.priority || '').toLowerCase().replace(/[^a-z]/g,'');
      priSpan.className = 'groomed-priority groomed-priority-' + priKey;
      priSpan.textContent = sd.priority;
      li.appendChild(priSpan);
    }
    if (sd.points != null) {
      const ptsSpan = document.createElement('span');
      ptsSpan.className = 'groomed-points';
      ptsSpan.textContent = sd.points + ' pts';
      li.appendChild(ptsSpan);
    }
    const depCount = (sd.dependencies || []).length;
    if (depCount) {
      const dep = document.createElement('span');
      dep.className = 'groomed-deps-count';
      dep.textContent = depCount + ' dep(s)';
      li.appendChild(dep);
    }
    const odcTags = [].concat(sd.odc_entities || [], sd.odc_screens || []).slice(0,3);
    if (odcTags.length) {
      const meta = document.createElement('div');
      meta.className = 'groomed-story-meta';
      odcTags.forEach(function(t){
        const c = document.createElement('code');
        c.textContent = t;
        meta.appendChild(c);
        meta.appendChild(document.createTextNode(' '));
      });
      li.appendChild(meta);
    }
    li.addEventListener('click', function(){ openStoryDetail(story.id); });
    return li;
  }

  function renderTree() {
    const host = $g('groomed-tree');
    if (!host || !groomedState.tree) return;
    host.textContent = '';
    const tree = groomedState.tree;
    if (!(tree.epics || []).length && !(tree.orphans || []).length) {
      const p = document.createElement('p');
      p.className = 'muted-text';
      p.textContent = 'No groomed backlog yet. Upload requirements to begin.';
      host.appendChild(p);
      return;
    }
    (tree.epics || []).forEach(function(epic) {
      const ec = epic.structured_data || {};
      const details = document.createElement('details');
      details.className = 'groomed-epic';
      details.open = true;
      const summary = document.createElement('summary');
      const strong = document.createElement('strong');
      strong.textContent = 'EPIC: ' + (epic.title || 'Epic');
      summary.appendChild(strong);
      if (ec.story) {
        const sm = document.createElement('span');
        sm.className = 'muted-text text-sm';
        sm.textContent = '  ' + ec.story;
        summary.appendChild(sm);
      }
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'groomed-epic-body';
      (epic.features || []).forEach(function(f) {
        const fc = f.structured_data || {};
        const fd = document.createElement('details');
        fd.className = 'groomed-feature';
        fd.open = true;
        const fs = document.createElement('summary');
        const fstr = document.createElement('strong');
        fstr.textContent = 'FEATURE: ' + (f.title || 'Feature');
        fs.appendChild(fstr);
        if (fc.story) {
          const dsm = document.createElement('span');
          dsm.className = 'muted-text text-sm';
          dsm.textContent = '  ' + fc.story;
          fs.appendChild(dsm);
        }
        const cnt = document.createElement('span');
        cnt.className = 'groomed-count';
        cnt.textContent = (f.stories || []).length;
        fs.appendChild(cnt);
        fd.appendChild(fs);
        const ul = document.createElement('ul');
        ul.className = 'groomed-story-list';
        (f.stories || []).forEach(function(s) { ul.appendChild(buildStoryItem(s)); });
        if (!(f.stories || []).length) {
          const emptyLi = document.createElement('li');
          emptyLi.className = 'muted-text text-sm';
          emptyLi.textContent = '(no stories)';
          ul.appendChild(emptyLi);
        }
        fd.appendChild(ul);
        body.appendChild(fd);
      });
      if ((epic.unparented_stories || []).length) {
        const ul = document.createElement('ul');
        ul.className = 'groomed-story-list';
        (epic.unparented_stories || []).forEach(function(s) { ul.appendChild(buildStoryItem(s)); });
        body.appendChild(ul);
      }
      details.appendChild(body);
      host.appendChild(details);
    });
    if ((tree.orphans || []).length) {
      const d = document.createElement('details');
      d.className = 'groomed-epic';
      const sum = document.createElement('summary');
      const str = document.createElement('strong');
      str.textContent = 'Unassigned stories';
      sum.appendChild(str);
      d.appendChild(sum);
      const ul = document.createElement('ul');
      ul.className = 'groomed-story-list';
      (tree.orphans || []).forEach(function(s) { ul.appendChild(buildStoryItem(s)); });
      d.appendChild(ul);
      host.appendChild(d);
    }
  }

  function renderMentorList() {
    const host = $g('groomed-mentor-list');
    if (!host || !groomedState.tree) return;
    host.textContent = '';
    const stories = [];
    (groomedState.tree.epics || []).forEach(function(e) {
      (e.features || []).forEach(function(f) { (f.stories || []).forEach(function(s){ stories.push(s); }); });
      (e.unparented_stories || []).forEach(function(s){ stories.push(s); });
    });
    (groomedState.tree.orphans || []).forEach(function(s){ stories.push(s); });
    if (!stories.length) {
      const p = document.createElement('p');
      p.className = 'muted-text';
      p.textContent = 'No stories yet.';
      host.appendChild(p);
      return;
    }
    stories.forEach(function(s) {
      const sd = s.structured_data || {};
      const prompt = sd.mentor_prompt || '';
      const card = document.createElement('div');
      card.className = 'groomed-mentor-card' + (prompt.trim() ? '' : ' has-no-prompt');
      card.dataset.storyId = s.id;
      const head = document.createElement('div');
      head.className = 'groomed-mentor-card-head';
      const strong = document.createElement('strong');
      strong.textContent = s.title || 'Untitled';
      head.appendChild(strong);
      const state = document.createElement('span');
      state.className = 'groomed-mentor-state';
      state.textContent = prompt.trim() ? prompt.length + ' chars' : 'no prompt yet';
      head.appendChild(state);
      card.appendChild(head);
      const preview = document.createElement('div');
      preview.className = 'groomed-mentor-preview';
      preview.textContent = prompt.trim() ? prompt.substring(0, 220) + (prompt.length > 220 ? '...' : '') : '(click to open and generate)';
      card.appendChild(preview);
      card.addEventListener('click', function() { openStoryDetail(s.id); });
      host.appendChild(card);
    });
  }

  // ===== Story detail modal =====
  function findStoryById(id) {
    if (!groomedState.tree) return null;
    function walk(list) { for (var i=0; i<list.length; i++) if (list[i].id === id) return list[i]; return null; }
    const epics = groomedState.tree.epics || [];
    for (let i=0; i<epics.length; i++) {
      const e = epics[i];
      for (let j=0; j<(e.features || []).length; j++) { const hit = walk(e.features[j].stories || []); if (hit) return hit; }
      const hit = walk(e.unparented_stories || []); if (hit) return hit;
    }
    return walk(groomedState.tree.orphans || []);
  }

  function openStoryDetail(storyId) {
    const story = findStoryById(storyId);
    if (!story) { setStatus('Story not found.', 'error'); return; }
    groomedState.storyBeingEdited = storyId;
    const sd = story.structured_data || {};
    $g('groomed-story-title').textContent = story.title || 'Story detail';
    const body = $g('groomed-story-body');
    body.textContent = '';

    function row(labelText, control) {
      const div = document.createElement('div');
      div.className = 'gs-row';
      const label = document.createElement('label');
      label.textContent = labelText;
      div.appendChild(label);
      div.appendChild(control);
      return div;
    }
    function input(id, value) {
      const el = document.createElement('input');
      el.type = 'text'; el.id = id; el.className = 'theme-input';
      el.value = value == null ? '' : String(value);
      return el;
    }
    function textarea(id, value, rows) {
      const el = document.createElement('textarea');
      el.id = id; el.className = 'theme-input'; el.rows = rows || 2;
      el.value = value == null ? '' : String(value);
      return el;
    }
    function select(id, options, current) {
      const el = document.createElement('select');
      el.id = id; el.className = 'theme-input';
      options.forEach(function(o){
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        if (o === current) opt.selected = true;
        el.appendChild(opt);
      });
      return el;
    }

    body.appendChild(row('Title', input('gs-title', story.title || '')));
    body.appendChild(row('User Story', textarea('gs-story', sd.story || '', 2)));
    body.appendChild(row('Acceptance Criteria', textarea('gs-ac',
      Array.isArray(sd.acceptance_criteria) ? sd.acceptance_criteria.join('\n') : (sd.acceptance_criteria || ''), 5)));

    function col(labelText, ctrl) {
      const d = document.createElement('div');
      const l = document.createElement('label'); l.textContent = labelText;
      d.appendChild(l); d.appendChild(ctrl);
      return d;
    }
    const grid3 = document.createElement('div');
    grid3.className = 'gs-grid3';
    grid3.appendChild(col('Points', input('gs-pts', sd.points != null ? sd.points : '')));
    grid3.appendChild(col('Priority', select('gs-prio', ['Must','Should','Could','Wont'], sd.priority)));
    grid3.appendChild(col('Type', select('gs-type', ['story','bug','spike','tech-debt'], sd.type || 'story')));
    body.appendChild(grid3);

    body.appendChild(row('NFR Notes', textarea('gs-nfr', sd.nfr_notes || '', 2)));
    body.appendChild(row('Risks and Assumptions', textarea('gs-risks', sd.risks_assumptions || '', 2)));
    body.appendChild(row('Definition of Done', textarea('gs-dod', sd.definition_of_done || '', 2)));

    const grid2 = document.createElement('div');
    grid2.className = 'gs-grid2';
    grid2.appendChild(col('ODC Entities', input('gs-ent', (sd.odc_entities || []).join(', '))));
    grid2.appendChild(col('ODC Screens', input('gs-scr', (sd.odc_screens || []).join(', '))));
    body.appendChild(grid2);

    const mentorRow = document.createElement('div');
    mentorRow.className = 'gs-row';
    const mentorLabel = document.createElement('label');
    mentorLabel.textContent = 'ODC Mentor 2.0 Prompt ';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'link-btn'; copyBtn.id = 'gs-copy-mentor'; copyBtn.textContent = '[Copy]';
    mentorLabel.appendChild(copyBtn);
    mentorRow.appendChild(mentorLabel);
    mentorRow.appendChild(textarea('gs-mentor', sd.mentor_prompt || '', 8));
    body.appendChild(mentorRow);

    const depRow = document.createElement('div');
    depRow.className = 'gs-row';
    const depLabel = document.createElement('label'); depLabel.textContent = 'Dependencies';
    depRow.appendChild(depLabel);
    const depBody = document.createElement('div'); depBody.id = 'gs-deps'; depBody.className = 'gs-deps';
    const deps = sd.dependencies || [];
    if (!deps.length) {
      const em = document.createElement('em'); em.className = 'muted-text text-sm'; em.textContent = 'No dependencies';
      depBody.appendChild(em);
    } else {
      const ul = document.createElement('ul'); ul.className = 'gs-deps-list';
      deps.forEach(function(d) {
        const li = document.createElement('li');
        const code = document.createElement('code'); code.textContent = '#' + d.target_id;
        li.appendChild(code);
        const type = document.createElement('span'); type.className = 'groomed-dep-type'; type.textContent = ' ' + (d.type || '') + ' ';
        li.appendChild(type);
        li.appendChild(document.createTextNode((d.reason || '')));
        const by = document.createElement('span'); by.className = 'muted-text text-sm'; by.textContent = '  (' + (d.added_by || 'agent') + ')';
        li.appendChild(by);
        ul.appendChild(li);
      });
      depBody.appendChild(ul);
    }
    depRow.appendChild(depBody);
    body.appendChild(depRow);

    copyBtn.addEventListener('click', function(e){
      e.preventDefault();
      const mt = $g('gs-mentor');
      const txt = mt ? mt.value : '';
      navigator.clipboard.writeText(txt).then(function(){ setStatus('Mentor prompt copied.', 'success'); });
    });

    $g('groomed-story-overlay').classList.remove('hidden');
  }

  function closeStoryDetail() {
    $g('groomed-story-overlay').classList.add('hidden');
    groomedState.storyBeingEdited = null;
  }

  async function saveStoryEdits() {
    if (!groomedState.storyBeingEdited) return;
    const partial = {
      title: ($g('gs-title').value || '').trim(),
      story: ($g('gs-story').value || '').trim(),
      acceptance_criteria: ($g('gs-ac').value || '').split('\n').map(function(l){ return l.trim(); }).filter(Boolean),
      points: parseInt($g('gs-pts').value, 10) || null,
      priority: ($g('gs-prio').value || '').toLowerCase(),
      type: $g('gs-type').value,
      nfr_notes: ($g('gs-nfr').value || '').trim(),
      risks_assumptions: ($g('gs-risks').value || '').trim(),
      definition_of_done: ($g('gs-dod').value || '').trim(),
      odc_entities: ($g('gs-ent').value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean),
      odc_screens: ($g('gs-scr').value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean),
      mentor_prompt: $g('gs-mentor').value,
    };
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/backlog-items/' + groomedState.storyBeingEdited, {
        method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(partial),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('Story saved.', 'success');
      closeStoryDetail();
      await refreshBacklogTree();
    } catch (e) { setStatus('Save failed: ' + e, 'error'); }
  }

  async function regenerateMentorPrompt() {
    if (!groomedState.storyBeingEdited) return;
    setStatus('Regenerating Mentor prompt...', 'busy');
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/backlog-items/' + groomedState.storyBeingEdited + '/mentor-prompt/regenerate', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const mt = $g('gs-mentor'); if (mt) mt.value = data.mentor_prompt || '';
      setStatus('Mentor prompt regenerated.', 'success');
      await refreshBacklogTree();
    } catch (e) { setStatus('Regenerate failed: ' + e, 'error'); }
  }

  // ===== Dependency graph (Mermaid) =====
  async function refreshDepsGraph() {
    if (!groomedState.projectId) return;
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/groomed-backlog/dependency-graph');
      groomedState.depGraph = await res.json();
      renderDepsGraph();
    } catch (e) { console.warn('deps graph', e); }
  }

  function renderDepsGraph() {
    const host = $g('groomed-deps-graph');
    if (!host || !groomedState.depGraph) return;
    const g = groomedState.depGraph;
    host.textContent = '';
    if (!g.nodes || !g.nodes.length) {
      const p = document.createElement('p');
      p.className = 'muted-text';
      p.textContent = 'No stories to graph yet.';
      host.appendChild(p);
      return;
    }
    const cpSet = {};
    (groomedState.criticalPath || []).forEach(function(id){ cpSet[id] = true; });
    const lines = ['graph LR'];
    g.nodes.forEach(function(n) {
      const labelShort = (n.title || 'Story').replace(/[\[\]()"]/g,'').substring(0, 30);
      const styleMarker = cpSet[n.id] ? ':::critical' : '';
      lines.push('  n' + n.id + '["' + labelShort + '<br/><small>' + (n.points || '?') + ' pts</small>"]' + styleMarker);
    });
    g.edges.forEach(function(e) {
      const arrow = e.type === 'blocks' ? '-->' : '-.->';
      lines.push('  n' + e.from + ' ' + arrow + ' n' + e.to);
    });
    lines.push('  classDef critical fill:#ff3d71,stroke:#ff3d71,color:#fff;');
    const mermaidSrc = lines.join('\n');
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = mermaidSrc;
    host.appendChild(div);
    if (window.mermaid) {
      try {
        window.mermaid.run({nodes: host.querySelectorAll('.mermaid')});
      } catch (e1) {
        try { window.mermaid.init(undefined, host.querySelectorAll('.mermaid')); } catch(e2) { console.warn('mermaid render', e2); }
      }
    }
    const legend = $g('groomed-deps-legend');
    if (legend) {
      legend.textContent = '';
      const strong = document.createElement('strong'); strong.textContent = 'Legend: ';
      legend.appendChild(strong);
      const s1 = document.createElement('span'); s1.className = 'dep-legend-solid'; s1.textContent = '-> blocks';
      const s2 = document.createElement('span'); s2.className = 'dep-legend-dashed'; s2.textContent = '-.-> blocked by';
      const s3 = document.createElement('span'); s3.className = 'dep-legend-critical'; s3.textContent = 'critical path';
      legend.appendChild(s1); legend.appendChild(document.createTextNode(' '));
      legend.appendChild(s2); legend.appendChild(document.createTextNode(' '));
      legend.appendChild(s3);
      if (Object.keys(cpSet).length) {
        const cn = document.createElement('span'); cn.className = 'muted-text';
        cn.textContent = '  (' + Object.keys(cpSet).length + ' stories on critical path)';
        legend.appendChild(cn);
      }
    }
  }

  // ===== Multi-dev schedule =====
  async function recomputeSchedule() {
    if (!groomedState.projectId) return;
    const devs = parseInt(($g('groomed-sched-devs') || {}).value || '3', 10);
    const cap = parseInt(($g('groomed-sched-capacity') || {}).value || '13', 10);
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/groomed-backlog/schedule?dev_count=' + devs + '&sprint_capacity=' + cap);
      const data = await res.json();
      groomedState.schedule = data.schedule;
      groomedState.criticalPath = data.critical_path_ids;
      renderSchedule(data);
      if (groomedState.depGraph) renderDepsGraph();
    } catch (e) { console.warn('schedule', e); }
  }

  function renderSchedule(data) {
    const host = $g('groomed-sched-gantt');
    if (!host) return;
    host.textContent = '';
    const sched = data.schedule;
    if (!sched || !sched.assignments || !sched.assignments.length) {
      const p = document.createElement('p');
      p.className = 'muted-text';
      p.textContent = 'No stories assigned yet.';
      host.appendChild(p);
      const s = $g('groomed-sched-summary'); if (s) s.textContent = '';
      return;
    }
    const maxEnd = Math.max.apply(null, sched.assignments.map(function(a){ return a.end_points; }));
    const cpSet = {};
    (data.critical_path_ids || []).forEach(function(id){ cpSet[id] = true; });
    const byDev = {};
    sched.assignments.forEach(function(a) { (byDev[a.dev] = byDev[a.dev] || []).push(a); });

    // Axis
    const axis = document.createElement('div');
    axis.className = 'gantt-axis';
    const s0 = document.createElement('span'); s0.textContent = '0';
    const s1 = document.createElement('span'); s1.textContent = String(Math.floor(maxEnd/2));
    const s2 = document.createElement('span'); s2.textContent = maxEnd + ' pts';
    axis.appendChild(s0); axis.appendChild(s1); axis.appendChild(s2);
    host.appendChild(axis);

    const lanes = document.createElement('div'); lanes.className = 'gantt-lanes';
    Object.keys(byDev).sort(function(a,b){ return parseInt(a) - parseInt(b); }).forEach(function(devId) {
      const lane = document.createElement('div'); lane.className = 'gantt-lane';
      const labelCol = document.createElement('div'); labelCol.className = 'gantt-dev-label'; labelCol.textContent = 'Dev ' + devId;
      lane.appendChild(labelCol);
      const track = document.createElement('div'); track.className = 'gantt-track';
      byDev[devId].forEach(function(a) {
        const left = (a.start_points / maxEnd) * 100;
        const width = Math.max(3, (a.points / maxEnd) * 100);
        const bar = document.createElement('div');
        bar.className = 'gantt-bar' + (cpSet[a.story_id] ? ' is-critical' : '');
        bar.style.left = left + '%';
        bar.style.width = width + '%';
        bar.title = a.title + ' | ' + a.points + 'pts | sprint ' + a.sprint;
        const t = document.createElement('span'); t.textContent = a.title;
        const p = document.createElement('small'); p.textContent = a.points;
        bar.appendChild(t); bar.appendChild(p);
        track.appendChild(bar);
      });
      lane.appendChild(track);
      lanes.appendChild(lane);
    });
    host.appendChild(lanes);

    const summary = $g('groomed-sched-summary');
    if (summary) {
      summary.textContent = sched.predicted_sprint_count + ' sprint(s) estimated | ' +
        sched.predicted_total_points + ' total pts | critical path: ' + Object.keys(cpSet).length + ' story(ies)';
    }
  }

  // ===== Jira config + push =====
  async function openJiraConfig() {
    if (!groomedState.projectId) return;
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/jira-config');
      const cfg = await res.json();
      groomedState.jiraConfig = cfg;
      $g('groomed-jira-domain').value = cfg.domain || '';
      $g('groomed-jira-email').value = cfg.email || '';
      $g('groomed-jira-token').value = '';
      $g('groomed-jira-project-key').value = cfg.project_key || '';
      $g('groomed-jira-status').textContent = cfg.has_token
        ? 'Currently configured (token present). Re-enter token to update.'
        : 'No Jira config saved for this project yet.';
    } catch (e) {
      $g('groomed-jira-status').textContent = 'Could not load Jira config: ' + e;
    }
    $g('groomed-jira-overlay').classList.remove('hidden');
  }

  function closeJiraConfig() { $g('groomed-jira-overlay').classList.add('hidden'); }

  async function saveJiraConfig() {
    const body = {
      domain: $g('groomed-jira-domain').value.trim(),
      email: $g('groomed-jira-email').value.trim(),
      api_token: $g('groomed-jira-token').value.trim(),
      project_key: $g('groomed-jira-project-key').value.trim().toUpperCase(),
    };
    if (!body.api_token) {
      $g('groomed-jira-status').textContent = 'Enter your API token to save (existing token is never retrievable).';
      return;
    }
    $g('groomed-jira-status').textContent = 'Testing credentials with Atlassian...';
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/jira-config', {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
      });
      const data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.detail || res.statusText);
      $g('groomed-jira-status').textContent = 'OK: ' + data.auth + ' | ' + data.project;
      setStatus('Jira config saved and verified.', 'success');
      setTimeout(closeJiraConfig, 1500);
    } catch (e) { $g('groomed-jira-status').textContent = 'Failed: ' + e; }
  }

  async function clearJiraConfig() {
    if (!confirm('Clear the saved Jira configuration for this project?')) return;
    try {
      await fetch('/api/projects/' + groomedState.projectId + '/jira-config', {method:'DELETE'});
      setStatus('Jira config cleared.', 'success');
      closeJiraConfig();
    } catch (e) { setStatus('Clear failed: ' + e, 'error'); }
  }

  async function pushToJira() {
    if (!groomedState.projectId) return;
    if (!confirm('Push the current groomed backlog to Jira?')) return;
    setStatus('Pushing to Jira...', 'busy');
    try {
      const res = await fetch('/api/projects/' + groomedState.projectId + '/push-to-jira', {method:'POST'});
      const data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.detail || res.statusText);
      const errCount = (data.errors || []).length;
      const msg = 'Pushed ' + data.pushed_epics + ' epic(s) + ' + data.pushed_stories + ' story(ies) to ' + data.jira_project_key +
                  '. ' + (data.pushed_links || 0) + ' link(s) created.' +
                  (errCount ? ' (' + errCount + ' errors; see console)' : '');
      setStatus(msg, errCount ? 'error' : 'success');
      if (errCount) console.warn('[push-to-jira errors]', data.errors);
    } catch (e) { setStatus('Push failed: ' + e, 'error'); }
  }

  // ===== Public entry + init =====
  async function renderGroomedTab(projectId) {
    groomedState.projectId = projectId;
    switchGroomedView(groomedState.activeView || 'upload');
    await refreshUploads();
    await refreshBacklogTree();
  }
  window.renderGroomedTab = renderGroomedTab;

  function initGroomedTab() {
    document.querySelectorAll('.groomed-view-tab').forEach(function(btn) {
      btn.addEventListener('click', function() { switchGroomedView(btn.dataset.groomedView); });
    });

    const input = $g('groomed-upload-input');
    if (input) input.addEventListener('change', function(e) {
      handleFileSelected(e.target.files && e.target.files[0]);
    });
    const zone = document.querySelector('.groomed-upload-zone');
    if (zone) {
      zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', function() { zone.classList.remove('drag'); });
      zone.addEventListener('drop', function(e) {
        e.preventDefault(); zone.classList.remove('drag');
        handleFileSelected(e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }

    var b;
    b = $g('groomed-start-btn'); if (b) b.addEventListener('click', startGrooming);
    b = $g('groomed-refresh-btn'); if (b) b.addEventListener('click', function() {
      refreshUploads(); refreshBacklogTree();
      if (groomedState.activeView === 'deps') refreshDepsGraph();
      if (groomedState.activeView === 'schedule') recomputeSchedule();
    });

    b = $g('groomed-story-close'); if (b) b.addEventListener('click', closeStoryDetail);
    b = $g('groomed-story-cancel'); if (b) b.addEventListener('click', closeStoryDetail);
    b = $g('groomed-story-save'); if (b) b.addEventListener('click', saveStoryEdits);
    b = $g('groomed-story-regen-mentor'); if (b) b.addEventListener('click', regenerateMentorPrompt);
    b = $g('groomed-story-overlay'); if (b) b.addEventListener('click', function(e) {
      if (e.target.id === 'groomed-story-overlay') closeStoryDetail();
    });

    b = $g('groomed-sched-recompute'); if (b) b.addEventListener('click', recomputeSchedule);

    b = $g('groomed-jira-cfg-btn'); if (b) b.addEventListener('click', openJiraConfig);
    b = $g('groomed-jira-close'); if (b) b.addEventListener('click', closeJiraConfig);
    b = $g('groomed-jira-cfg-cancel'); if (b) b.addEventListener('click', closeJiraConfig);
    b = $g('groomed-jira-cfg-save'); if (b) b.addEventListener('click', saveJiraConfig);
    b = $g('groomed-jira-cfg-clear'); if (b) b.addEventListener('click', clearJiraConfig);
    b = $g('groomed-jira-overlay'); if (b) b.addEventListener('click', function(e) {
      if (e.target.id === 'groomed-jira-overlay') closeJiraConfig();
    });

    b = $g('groomed-push-jira-btn'); if (b) b.addEventListener('click', pushToJira);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGroomedTab);
  } else {
    initGroomedTab();
  }
})();
