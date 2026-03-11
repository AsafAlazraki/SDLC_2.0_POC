// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    
    // ─────────────────────────────────────────
    // Application State
    // ─────────────────────────────────────────
    const state = {
        geminiKey: localStorage.getItem('gemini_api_key') || '',
        activeClient: null,
        personaConfigs: {}
    };

    // ─────────────────────────────────────────
    // API Configuration & Status
    // ─────────────────────────────────────────
    async function updateAPIStatus() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            
            // Gemini Status
            const geminiStatus = document.getElementById('gemini-status');
            if (geminiStatus) {
                if (state.geminiKey) {
                    geminiStatus.innerHTML = '<span class="status-badge success">PASTED</span>';
                } else if (config.has_env_key) {
                    geminiStatus.innerHTML = '<span class="status-badge env">ENV SET</span>';
                } else {
                    geminiStatus.innerHTML = '<span class="status-badge error">MISSING</span>';
                }
            }

            // Anthropic Status
            const anthropicStatus = document.getElementById('anthropic-status');
            if (anthropicStatus) {
                if (config.has_anthropic_env_key) {
                    anthropicStatus.innerHTML = '<span class="status-badge env">ENV SET</span>';
                } else {
                    anthropicStatus.innerHTML = '<span class="status-badge error">MISSING</span>';
                }
            }
        } catch(e) { console.error("Could not load config", e); }
    }
    updateAPIStatus();

    // Fetch Persona Configs for Modal
    async function loadPersonaConfigs() {
        try {
            const res = await fetch('/api/personas/config');
            state.personaConfigs = await res.json();
        } catch(e) { console.error("Could not load persona configs", e); }
    }
    loadPersonaConfigs();

    // ─────────────────────────────────────────
    // Navigation Routing
    // ─────────────────────────────────────────
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => {
                v.classList.remove('active');
                v.classList.add('hidden');
            });
            btn.classList.add('active');
            const targetId = `view-${btn.dataset.target}`;
            const targetView = document.getElementById(targetId);
            if(targetView) {
                targetView.classList.remove('hidden');
                targetView.classList.add('active');
            }
        });
    });

    // ─────────────────────────────────────────
    // Client & Persona Management
    // ─────────────────────────────────────────
    async function loadClients() {
        try {
            const res = await fetch('/api/clients');
            const clients = await res.json();
            const select = document.getElementById('client-select');
            if (!select) return;

            select.innerHTML = '<option value="">-- Unassigned --</option>';
            clients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.innerText = c.name;
                select.appendChild(opt);
            });
            
            if (select.options.length > 1) {
                state.activeClient = select.value;
            }
        } catch(e) { console.error("Could not load clients", e); }
    }
    loadClients();

    document.getElementById('client-select')?.addEventListener('change', (e) => {
        state.activeClient = e.target.value || null;
    });

    // ─────────────────────────────────────────
    // API Key Handling
    // ─────────────────────────────────────────
    const geminiInput = document.getElementById('gemini-key');
    if (geminiInput) {
        geminiInput.value = state.geminiKey;
        geminiInput.addEventListener('input', (e) => {
            state.geminiKey = e.target.value;
            localStorage.setItem('gemini_api_key', e.target.value);
            updateAPIStatus();
        });
    }

    // Modal Closing
    const modal = document.getElementById('persona-modal');
    const closeBtn = document.getElementById('close-modal-btn');
    closeBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    function openPersonaModal(key) {
        const config = state.personaConfigs[key];
        if (!config) return;

        document.getElementById('modal-name').innerText = config.name;
        document.getElementById('modal-emoji').innerText = config.emoji;
        
        // Split mission from prompt if possible, or just show role
        document.getElementById('modal-mission').innerText = config.role_description || "Specialized SDLC Discovery Agent";
        document.getElementById('modal-homework').innerText = config.research_homework || "Analyzing source code patterns, library interactions, and architectural anti-patterns.";
        document.getElementById('modal-expectations').innerText = config.output_expectations || "Structured analysis results with clear actionable insights.";
        
        const modelBadge = document.getElementById('modal-model');
        modelBadge.innerText = config.model === 'anthropic' ? 'Claude Sonnet 4.6' : 'Gemini 2.0 Flash';
        modelBadge.className = `status-badge ${config.model === 'anthropic' ? 'success' : 'env'}`;

        modal.style.display = 'flex';
    }

    // ─────────────────────────────────────────
    // Fleet Interaction (GitHub)
    // ─────────────────────────────────────────
    const analyzeRepoBtn = document.getElementById('analyze-repo-btn');
    const repoLoader = document.getElementById('repo-loader');
    const statusText = document.getElementById('discovery-status-text');
    const statusDot = document.getElementById('status-dot');
    const agentStatusGrid = document.getElementById('agent-status-grid');

    analyzeRepoBtn?.addEventListener('click', async () => {
        const githubUrl = document.getElementById('github-url').value.trim();

        if(!githubUrl) {
            alert("Please enter a GitHub repository URL.");
            return;
        }

        analyzeRepoBtn.disabled = true;
        if (repoLoader) repoLoader.style.display = "inline-block";
        if (statusDot) statusDot.classList.replace('blinking', 'processing');
        if (statusText) statusText.innerText = "Initializing AI Fleet...";

        resetReport();
        document.querySelector('[data-target="report"]').click();

        try {
            const response = await fetch('/api/analyze-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    github_url: githubUrl,
                    gemini_api_key: state.geminiKey,
                    client_id: state.activeClient || null
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                let eventType = null;
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.substring(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const eventData = line.substring(6).trim();
                        handleSSEEvent(eventType, eventData);
                        eventType = null;
                    }
                }
            }

        } catch (e) {
            console.error("Discovery error", e);
            if (statusText) statusText.innerText = "Connection Error";
        } finally {
            analyzeRepoBtn.disabled = false;
            if (repoLoader) repoLoader.style.display = "none";
            if (statusDot) statusDot.classList.replace('processing', 'blinking');
        }
    });

    function handleSSEEvent(eventType, eventData) {
        try {
            const data = JSON.parse(eventData);

            if (eventType === 'status') {
                if (statusText) statusText.innerText = data.message;
                if (data.phase === 'agents_launched' && data.agents) {
                    updateStatusGrid(data.agents);
                }
                if (data.phase === 'complete') {
                    setTimeout(() => {
                        if (statusText) statusText.innerText = "Discovery Complete ✓";
                        const fill = document.getElementById('fleet-progress-fill');
                        if (fill) fill.style.width = '100%';
                    }, 500);
                }
            }

            if (eventType === 'agent_result') {
                renderAgentResult(data);
                const total = 11; 
                const doneCount = document.querySelectorAll('.agent-status-card.done').length;
                const progress = (doneCount / total) * 100;
                const progressFill = document.getElementById('fleet-progress-fill');
                if (progressFill) progressFill.style.width = `${progress}%`;
            }

            if (eventType === 'agent_update') {
                const agentCard = document.getElementById(`status-${data.key}`);
                if (agentCard) {
                    agentCard.className = `agent-status-card ${data.status}`;
                    const stateEl = agentCard.querySelector('.agent-state');
                    if (stateEl) stateEl.textContent = data.sub_status || data.status.toUpperCase();
                    
                    if (data.status === 'thinking') {
                        if (!agentCard.querySelector('.thinking-spinner')) {
                            const spinner = document.createElement('div');
                            spinner.className = 'thinking-spinner';
                            agentCard.appendChild(spinner);
                        }
                    } else {
                        const spinner = agentCard.querySelector('.thinking-spinner');
                        if (spinner) spinner.remove();
                    }
                }
            }

            if (eventType === 'error') {
                if (statusText) statusText.innerText = `Error: ${data.message}`;
            }
        } catch(e) { console.error("SSE parse error", e); }
    }

    function updateStatusGrid(agents) {
        if (!agentStatusGrid) return;
        agentStatusGrid.innerHTML = '';

        agents.forEach(agent => {
            const div = document.createElement('div');
            div.className = `agent-status-card ${agent.status}`;
            div.id = `status-${agent.key}`;
            
            let displayStatus = agent.status.toUpperCase();
            if (agent.status === 'thinking' && agent.sub_status) {
                displayStatus = agent.sub_status;
            }

            div.innerHTML = `
                <div class="agent-emoji">${agent.emoji}</div>
                <div class="agent-info">
                    <div class="agent-name">${agent.name}</div>
                    <div class="agent-state">${displayStatus}</div>
                </div>
                ${agent.status === 'thinking' ? '<div class="thinking-spinner"></div>' : ''}
            `;
            
            // Interaction: Open Profile Modal
            div.addEventListener('click', () => {
                openPersonaModal(agent.key);
            });

            agentStatusGrid.appendChild(div);
        });
    }

    function renderAgentResult(result) {
        const statusCard = document.getElementById(`status-${result.persona}`);
        if (statusCard) {
            statusCard.classList.remove('thinking');
            statusCard.classList.add(result.status === 'success' ? 'done' : 'error');
            const stateEl = statusCard.querySelector('.agent-state');
            if (stateEl) stateEl.textContent = result.status === 'success' ? 'READY' : 'ERROR';
            const spinner = statusCard.querySelector('.thinking-spinner');
            if (spinner) spinner.remove();
        }

        const reportCard = document.getElementById(`report-${result.persona}`);
        if (reportCard) {
            reportCard.style.display = 'block';
            reportCard.classList.add('fade-in');
            
            const header = reportCard.querySelector('.report-card-header');
            if (header && !header.dataset.listener) {
                const icon = document.createElement('span');
                icon.className = 'toggle-icon';
                icon.textContent = '▼';
                header.appendChild(icon);
                header.addEventListener('click', (e) => {
                    // Prevent click if we're clicking the title for modal? No, titles for modal are different.
                    toggleCard(result.persona);
                });
                header.dataset.listener = "true";
                
                // Secondary click for Profile Modal
                const profileHint = document.createElement('span');
                profileHint.className = 'profile-link';
                profileHint.innerText = 'Info';
                profileHint.style.fontSize = '0.65rem';
                profileHint.style.marginLeft = 'auto';
                profileHint.style.cursor = 'help';
                profileHint.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPersonaModal(result.persona);
                });
                header.insertBefore(profileHint, icon);
            }

            const contentEl = document.getElementById(`${result.persona}-content`);
            if (contentEl) {
                if (result.persona === 'ba' && result.status === 'success') {
                    renderJiraBacklog(result.content, contentEl);
                } else if (result.persona === 'architect' && result.status === 'success') {
                    renderModernisationRoadmap(result.content, contentEl);
                } else {
                    contentEl.innerHTML = simpleMarkdown(result.content);
                }
            }

            if (result.persona === 'architect' && result.status === 'success') {
                extractAndRenderMermaid(result.content);
            }
        }
    }

    function toggleCard(persona) {
        const card = document.getElementById(`report-${persona}`);
        if (card) {
            card.classList.toggle('collapsed');
        }
    }

    function renderJiraBacklog(content, container) {
        const stories = [];
        const storyRegex = /\*\*Title\*\*:\s*(.*?)\n\*\*Story Points\*\*:\s*(\d+)\n\*\*User Story\*\*:\s*(.*?)\n\*\*Acceptance Criteria\*\*:\s*([\s\S]*?)(?=\n\*\*Title\*\*|\n---|$)/g;
        
        let match;
        while ((match = storyRegex.exec(content)) !== null) {
            const pts = parseInt(match[2].trim());
            stories.push({
                title: match[1].trim(),
                points: pts,
                story: match[3].trim(),
                ac: match[4].trim(),
                priority: pts > 8 ? 'high' : pts > 3 ? 'med' : 'low'
            });
        }

        if (stories.length > 0) {
            container.innerHTML = `<div class="jira-board-header">
                <h4>Structured Backlog (Jira View)</h4>
                <div class="jira-actions">
                    <span class="jira-status-pill">Active Sprint</span>
                    <span class="jira-status-pill">Plan</span>
                </div>
            </div>
            <div class="backlog-board">
                <div class="backlog-column">
                    <div class="column-header">TODO <span>${stories.length}</span></div>
                    ${stories.map((s, idx) => `
                        <div class="backlog-card">
                            <div class="card-top">
                                <span class="card-key">BA-${idx + 1}</span>
                                <span class="card-tag priority-${s.priority}">${s.priority} priority</span>
                            </div>
                            <div class="card-title">${s.title}</div>
                            <div class="text-sm muted-text">${s.story.substring(0, 100)}...</div>
                            <div class="card-footer">
                                <span class="card-assignment">👤 Unassigned</span>
                                <span class="points-badge">${s.points}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="backlog-column"><div class="column-header">IN PROGRESS <span>0</span></div></div>
                <div class="backlog-column"><div class="column-header">DONE <span>0</span></div></div>
            </div>`;
            container.innerHTML += '<hr style="margin: 20px 0; border: none; border-top: 1px solid var(--border-subtle);">';
            container.innerHTML += simpleMarkdown(content);
        } else {
            container.innerHTML = simpleMarkdown(content);
        }
    }

    function renderModernisationRoadmap(content, container) {
        const roadmapSummary = document.getElementById('modernisation-roadmap-summary');
        const roadmapGrid = document.getElementById('roadmap-content');
        
        const phases = [];
        for(let i=1; i<=3; i++) {
            const phaseMatch = content.match(new RegExp(`Phase ${i}: (.*?)\n([\\s\\S]*?)(?=Phase ${i+1}|Key Risks|###|##|$)`, 'i'));
            if (phaseMatch) {
                phases.push({ num: i, title: phaseMatch[1].trim(), desc: phaseMatch[2].trim() });
            }
        }

        if (phases.length > 0 && roadmapSummary && roadmapGrid) {
            roadmapSummary.style.display = 'block';
            roadmapGrid.innerHTML = phases.map(p => `
                <div class="roadmap-phase">
                    <div class="phase-header">
                        <div class="phase-num">${p.num}</div>
                        <div style="font-weight: 700; font-size: 0.9rem;">${p.title}</div>
                    </div>
                    <div class="text-sm muted-text">${p.desc.substring(0, 150)}...</div>
                </div>
            `).join('');
        }
        container.innerHTML = simpleMarkdown(content);
    }

    function simpleMarkdown(text) {
        if (!text) return '<p class="muted-text">No content generated.</p>';
        
        // Escape HTML
        let escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Code blocks - keep them pre-formatted
        escaped = escaped.replace(/```(.*?)\n([\s\S]*?)```/g, (match, lang, code) => {
            if (lang.trim() === 'mermaid') return `<div class="mermaid-raw-code" style="display:none;">${code.trim()}</div>`;
            return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
        });

        let html = escaped
            .replace(/^### (.*$)/gim, '<h4 class="report-h4">$1</h4>')
            .replace(/^## (.*$)/gim, '<h3 class="report-h3">$1</h3>')
            .replace(/^# (.*$)/gim, '<h2 class="report-h2">$1</h2>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
            .replace(/^- (.*$)/gim, '<li class="report-li">$1</li>')
            .replace(/^\d+\. (.*$)/gim, '<li class="report-li">$1</li>')
            .replace(/\n\n/g, '</p><p class="report-p">')
            .replace(/\n/g, '<br>');
        
        return `<div class="markdown-body">${html}</div>`;
    }

    async function renderMermaidDiagram(chartDef) {
        const wrapper = document.getElementById('mermaid-wrapper');
        const output = document.getElementById('mermaid-output');
        if (!wrapper || !output) return;

        try {
            const mermaid = window.mermaid;
            if (!mermaid) return;

            output.innerHTML = '';
            wrapper.style.display = 'block';

            const id = 'mermaid-graph-' + Date.now();
            const { svg } = await mermaid.render(id, chartDef);
            output.innerHTML = svg;
        } catch (err) {
            console.warn('Mermaid render error:', err);
            const wrapper = document.getElementById('mermaid-wrapper');
            if (wrapper) wrapper.style.display = 'none';
        }
    }

    function extractAndRenderMermaid(content) {
        // Find mermaid block
        const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/);
        let chartDef = "";
        
        if (mermaidMatch) {
            chartDef = mermaidMatch[1].trim();
        } else {
            // Fallback: look for graph TD etc.
            const graphMatch = content.match(/(graph\s+(?:TD|LR|TB|BT|RL)[\s\S]*?)(?:\n\n|\n(?=[A-Z#])|$)/);
            if (graphMatch) chartDef = graphMatch[1].trim();
        }

        if (chartDef) {
            renderMermaidDiagram(chartDef);
        }
    }

    function resetReport() {
        document.querySelectorAll('.report-card').forEach(card => {
            card.style.display = 'none';
            card.classList.remove('fade-in');
            card.classList.remove('collapsed');
        });
        document.querySelectorAll('.report-content').forEach(el => { el.innerHTML = ''; });
        const roadmapSummary = document.getElementById('modernisation-roadmap-summary');
        if (roadmapSummary) roadmapSummary.style.display = 'none';
        const progressFill = document.getElementById('fleet-progress-fill');
        if (progressFill) progressFill.style.width = '0%';
        if (agentStatusGrid) agentStatusGrid.innerHTML = '';
        const mermaidWrapper = document.getElementById('mermaid-wrapper');
        if (mermaidWrapper) mermaidWrapper.style.display = 'none';
    }

    // ─────────────────────────────────────────
    // Collapse / Expand All
    // ─────────────────────────────────────────
    document.getElementById('collapse-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.report-card').forEach(card => {
            if (card.style.display !== 'none') card.classList.add('collapsed');
        });
    });

    document.getElementById('expand-all-btn')?.addEventListener('click', () => {
        document.querySelectorAll('.report-card').forEach(card => {
            card.classList.remove('collapsed');
        });
    });

    // ─────────────────────────────────────────
    // Admin: Create Client & Persona
    // ─────────────────────────────────────────
    document.getElementById('create-client-btn')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('new-client-name');
        const descInput = document.getElementById('new-client-desc');
        const name = nameInput?.value.trim();
        const description = descInput?.value.trim();

        if (!name) { alert('Client name is required.'); return; }

        try {
            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            if (res.ok) {
                nameInput.value = '';
                descInput.value = '';
                await loadClients();
                alert(`Client "${name}" created successfully.`);
            } else {
                const err = await res.json();
                alert(`Error: ${err.detail || 'Could not create client.'}`);
            }
        } catch (e) {
            console.error('Create client error', e);
            alert('Network error creating client.');
        }
    });

    document.getElementById('create-persona-btn')?.addEventListener('click', async () => {
        const roleInput = document.getElementById('new-persona-model');
        const promptInput = document.getElementById('new-persona-prompt');
        const role_name = roleInput?.value.trim();
        const system_prompt = promptInput?.value.trim();

        if (!role_name || !system_prompt) { alert('Role name and system prompt are required.'); return; }

        try {
            const res = await fetch('/api/personas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role_name, system_prompt })
            });
            if (res.ok) {
                roleInput.value = '';
                promptInput.value = '';
                alert(`Persona "${role_name}" created successfully.`);
            } else {
                const err = await res.json();
                alert(`Error: ${err.detail || 'Could not create persona.'}`);
            }
        } catch (e) {
            console.error('Create persona error', e);
            alert('Network error creating persona.');
        }
    });

    // ─────────────────────────────────────────
    // Legacy File/Text Analysis (Keep for Compatibility)
    // ─────────────────────────────────────────
    const analyzeBtn = document.getElementById('analyze-btn');
    const assetInput = document.getElementById('asset-input');

    analyzeBtn?.addEventListener('click', async () => {
        const payloadText = assetInput.value.trim();
        if(!payloadText) { alert("Please provide input text."); return; }
        analyzeBtn.disabled = true;
        
        resetReport();
        document.querySelector('[data-target="report"]').click();

        try {
            const formData = new FormData();
            formData.append('apiKey', state.geminiKey);
            if (payloadText) formData.append('text_context', payloadText);
            
            const response = await fetch('/api/analyze', { method: 'POST', body: formData });
            const data = await response.json();

            if (data.status === 'success') {
                for (const [persona, content] of Object.entries(data.results)) {
                    renderAgentResult({ persona, name: persona, emoji: '🤖', status: 'success', content });
                }
            }
        } catch (e) {
            console.error("Legacy API error", e);
        } finally {
            analyzeBtn.disabled = false;
        }
    });

});
