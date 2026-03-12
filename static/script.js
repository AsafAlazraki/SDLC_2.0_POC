// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    
    // ─────────────────────────────────────────
    // Application State
    // ─────────────────────────────────────────
    const state = {
        geminiKey: localStorage.getItem('gemini_api_key') || '',
        activeClient: null,
        personaConfigs: {},
        reportContents: {},      // Stores each agent's raw content for Q&A chat
        currentChatPersona: null // Which agent the chat modal is open for
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

            // GitHub Status
            const githubStatus = document.getElementById('github-status');
            if (githubStatus) {
                if (config.has_github_token) {
                    githubStatus.innerHTML = '<span class="status-badge env">TOKEN SET</span>';
                } else {
                    githubStatus.innerHTML = '<span class="status-badge error">MISSING</span>';
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
    const agentStatusGrid = document.getElementById('agent-status-grid');

    function collectBusinessContext() {
        const parts = [];
        const industry = document.getElementById('ctx-industry')?.value.trim();
        const compliance = document.getElementById('ctx-compliance')?.value.trim();
        const painPoints = document.getElementById('ctx-pain-points')?.value.trim();
        const goals = document.getElementById('ctx-goals')?.value.trim();
        const stakeholders = document.getElementById('ctx-stakeholders')?.value.trim();
        const team = document.getElementById('ctx-team')?.value.trim();
        if (industry) parts.push(`Industry/Domain: ${industry}`);
        if (compliance) parts.push(`Compliance Requirements: ${compliance}`);
        if (painPoints) parts.push(`Known Pain Points: ${painPoints}`);
        if (goals) parts.push(`Modernisation Goals & Constraints: ${goals}`);
        if (stakeholders) parts.push(`Stakeholder Context: ${stakeholders}`);
        if (team) parts.push(`Current Team & Skills: ${team}`);
        return parts.join('\n');
    }

    analyzeRepoBtn?.addEventListener('click', async () => {
        const githubUrl = document.getElementById('github-url').value.trim();

        if(!githubUrl) {
            alert("Please enter a GitHub repository URL.");
            return;
        }

        analyzeRepoBtn.disabled = true;
        if (repoLoader) repoLoader.style.display = "inline-block";

        resetReport();
        document.querySelector('[data-target="report"]').click();

        const additionalContext = collectBusinessContext();

        try {
            const response = await fetch('/api/analyze-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    github_url: githubUrl,
                    gemini_api_key: state.geminiKey,
                    client_id: state.activeClient || null,
                    additional_context: additionalContext || null
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
        } finally {
            analyzeRepoBtn.disabled = false;
            if (repoLoader) repoLoader.style.display = "none";
        }
    });

    function handleSSEEvent(eventType, eventData) {
        try {
            const data = JSON.parse(eventData);

            if (eventType === 'status') {
                updateFleetStatusMessage(data.message);
                if (data.phase === 'agents_launched' && data.agents) {
                    updateStatusGrid(data.agents);
                }
                if (data.phase === 'complete') {
                    setTimeout(() => {
                        updateFleetStatusMessage("Discovery Complete ✓");
                        const fill = document.getElementById('fleet-progress-fill');
                        if (fill) fill.style.width = '100%';
                    }, 500);
                }
            }

            if (eventType === 'agent_result') {
                renderAgentResult(data);
                const total = 16; // 15 personas + 1 synthesis
                const doneCount = document.querySelectorAll('.agent-status-card.done').length;
                const progress = (doneCount / total) * 100;
                const progressFill = document.getElementById('fleet-progress-fill');
                if (progressFill) progressFill.style.width = `${progress}%`;
            }

            if (eventType === 'agent_update') {
                // Recon pre-pass has no card — surface its progress in the fleet status bar
                if (data.key === 'recon') {
                    updateFleetStatusMessage(
                        data.status === 'complete'
                            ? `🔍 Reconnaissance complete — launching ${Object.keys(state.personaConfigs).length} agents...`
                            : `🔍 ${data.sub_status || 'Running codebase reconnaissance...'}`
                    );
                }
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
                updateFleetStatusMessage(`Error: ${data.message}`);
            }
        } catch(e) { console.error("SSE parse error", e); }
    }

    function updateFleetStatusMessage(msg) {
        const el = document.getElementById('fleet-status-message');
        if (el) el.textContent = msg;
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
                
                // "Ask" button — opens Q&A chat for this agent
                const askBtn = document.createElement('button');
                askBtn.className = 'ask-btn';
                askBtn.innerText = '💬 Ask';
                askBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openChatModal(result.persona);
                });
                header.insertBefore(askBtn, icon);

                // Copy to clipboard button
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.title = 'Copy to clipboard';
                copyBtn.innerText = '📋';
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(state.reportContents[result.persona] || '').then(() => {
                        copyBtn.innerText = '✅';
                        setTimeout(() => { copyBtn.innerText = '📋'; }, 1500);
                    });
                });
                header.insertBefore(copyBtn, askBtn);

                // Download markdown button
                const dlBtn = document.createElement('button');
                dlBtn.className = 'copy-btn';
                dlBtn.title = 'Download as Markdown';
                dlBtn.innerText = '⬇️';
                dlBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const content = state.reportContents[result.persona] || '';
                    const blob = new Blob([content], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `sdlc-discovery-${result.persona}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                });
                header.insertBefore(dlBtn, copyBtn);

                // Profile info link
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
                header.insertBefore(profileHint, dlBtn);
            }

            // Store content for Q&A chat context
            state.reportContents[result.persona] = result.content || '';
            state.lastAnalyzedUrl = document.getElementById('github-url')?.value.trim() || '[local upload]';

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

            // BA card: GitHub Issues export + CSV download
            if (result.persona === 'ba' && result.status === 'success') {
                const header = reportCard.querySelector('.report-card-header');
                if (header && !header.querySelector('.gh-export-btn')) {
                    const exportBtn = document.createElement('button');
                    exportBtn.className = 'gh-export-btn secondary-btn btn-sm';
                    exportBtn.innerText = '🐙 Export to GitHub Issues';
                    exportBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        exportToGitHubIssues(result.content);
                    });
                    header.appendChild(exportBtn);

                    const csvBtn = document.createElement('button');
                    csvBtn.className = 'secondary-btn btn-sm';
                    csvBtn.innerText = '📊 Download Backlog CSV';
                    csvBtn.title = 'Export backlog as CSV for Jira import';
                    csvBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        exportBacklogCSV(result.content);
                    });
                    header.appendChild(csvBtn);
                }
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
        updateFleetStatusMessage('');
        state.reportContents = {};
        state.lastAnalyzedUrl = null;
    }

    // ─────────────────────────────────────────
    // Q&A Chat Modal
    // ─────────────────────────────────────────
    const chatModal = document.getElementById('chat-modal');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    function openChatModal(personaKey) {
        const allConfigs = { ...state.personaConfigs, synthesis: { name: 'The Verdict', emoji: '🎯' } };
        const config = allConfigs[personaKey] || { name: personaKey, emoji: '🤖' };
        state.currentChatPersona = personaKey;
        document.getElementById('chat-modal-emoji').innerText = config.emoji || '🤖';
        document.getElementById('chat-modal-name').innerText = config.name || personaKey;
        chatMessages.innerHTML = '<div class="chat-placeholder muted-text text-sm">Ask anything about this agent\'s findings...</div>';
        if (chatInput) chatInput.value = '';
        chatModal.style.display = 'flex';
        chatInput?.focus();
    }

    closeChatBtn?.addEventListener('click', () => { chatModal.style.display = 'none'; });
    window.addEventListener('click', (e) => { if (e.target === chatModal) chatModal.style.display = 'none'; });

    async function sendChatMessage() {
        const question = chatInput?.value.trim();
        if (!question || !state.currentChatPersona) return;

        chatInput.value = '';
        chatInput.disabled = true;
        chatSendBtn.disabled = true;

        // Remove placeholder
        chatMessages.querySelector('.chat-placeholder')?.remove();

        // User bubble
        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble user-bubble';
        userBubble.innerText = question;
        chatMessages.appendChild(userBubble);

        // Agent typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'chat-bubble agent-bubble typing';
        typingEl.innerText = '...';
        chatMessages.appendChild(typingEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    persona_key: state.currentChatPersona,
                    question,
                    agent_report: state.reportContents[state.currentChatPersona] || ''
                })
            });
            const data = await res.json();
            typingEl.className = 'chat-bubble agent-bubble';
            typingEl.innerHTML = simpleMarkdown(data.response || data.detail || 'No response.');
        } catch (e) {
            typingEl.className = 'chat-bubble agent-bubble error';
            typingEl.innerText = 'Network error — could not reach the agent.';
        } finally {
            chatInput.disabled = false;
            chatSendBtn.disabled = false;
            chatInput.focus();
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    chatSendBtn?.addEventListener('click', sendChatMessage);
    chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

    // ─────────────────────────────────────────
    // GitHub Issues Export
    // ─────────────────────────────────────────
    async function exportToGitHubIssues(baContent) {
        const githubUrl = document.getElementById('github-url')?.value.trim();
        if (!githubUrl) {
            alert('GitHub URL not found. Please re-run the analysis first.');
            return;
        }

        // Parse stories using the same regex as renderJiraBacklog
        const storyRegex = /\*\*Title\*\*:\s*(.*?)\n\*\*Story Points\*\*:\s*(\d+)\n\*\*User Story\*\*:\s*(.*?)\n\*\*Acceptance Criteria\*\*:\s*([\s\S]*?)(?=\n\*\*Title\*\*|\n---|$)/g;
        const stories = [];
        let match;
        while ((match = storyRegex.exec(baContent)) !== null) {
            const pts = parseInt(match[2].trim());
            const acRaw = match[4].trim();
            const acLines = acRaw.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
            stories.push({
                title: match[1].trim(),
                story: match[3].trim(),
                ac: acLines,
                points: pts,
                priority: pts > 8 ? 'high' : pts > 3 ? 'med' : 'low'
            });
        }

        if (stories.length === 0) {
            alert('No structured stories found in the BA report to export.');
            return;
        }

        if (!confirm(`Export ${stories.length} user stories as GitHub Issues to ${githubUrl}?\n\nThis requires GITHUB_TOKEN to be set in your .env file.`)) return;

        try {
            const res = await fetch('/api/create-github-issues', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ github_url: githubUrl, stories })
            });
            const result = await res.json();
            if (!res.ok) {
                alert(`Error: ${result.detail}`);
                return;
            }
            const msg = `✅ Created ${result.created.length} issues.\n${result.failed.length > 0 ? `⚠️ ${result.failed.length} failed.` : ''}\n\nFirst issue: ${result.created[0]?.url || ''}`;
            alert(msg);
        } catch (e) {
            alert('Network error during GitHub Issues export.');
        }
    }

    function exportBacklogCSV(baContent) {
        const storyRegex = /\*\*Title\*\*:\s*(.*?)\n\*\*Story Points\*\*:\s*(\d+)\n\*\*User Story\*\*:\s*(.*?)\n\*\*Acceptance Criteria\*\*:\s*([\s\S]*?)(?=\n\*\*Title\*\*|\n---|$)/g;
        const rows = [['Summary', 'Story Points', 'User Story', 'Acceptance Criteria', 'Issue Type', 'Priority']];
        let match;
        while ((match = storyRegex.exec(baContent)) !== null) {
            const pts = parseInt(match[2].trim());
            const priority = pts > 8 ? 'High' : pts > 3 ? 'Medium' : 'Low';
            const acLines = match[4].trim().split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).join(' | ');
            rows.push([
                `"${match[1].trim().replace(/"/g, '""')}"`,
                pts,
                `"${match[3].trim().replace(/"/g, '""')}"`,
                `"${acLines.replace(/"/g, '""')}"`,
                'Story',
                priority
            ]);
        }
        if (rows.length <= 1) { alert('No structured stories found to export.'); return; }
        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sdlc-backlog.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─────────────────────────────────────────
    // History View
    // ─────────────────────────────────────────
    async function loadHistory() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;
        try {
            const res = await fetch('/api/reports');
            const reports = await res.json();

            if (!reports || reports.length === 0) {
                historyList.innerHTML = '<p class="muted-text">No past analyses yet. Run an analysis to see history here.</p>';
                return;
            }

            historyList.innerHTML = reports.map(r => `
                <div class="history-item" data-id="${r.id}">
                    <div class="history-item-main">
                        <span class="history-repo">${r.github_url}</span>
                        <span class="history-date muted-text text-sm">${new Date(r.analyzed_at).toLocaleString()}</span>
                    </div>
                    <button class="secondary-btn btn-sm history-load-btn" data-id="${r.id}">Load Report →</button>
                </div>
            `).join('');

            historyList.querySelectorAll('.history-load-btn').forEach(btn => {
                btn.addEventListener('click', () => loadHistoryReport(parseInt(btn.dataset.id)));
            });
        } catch (e) {
            historyList.innerHTML = '<p class="muted-text">Could not load history (Supabase reports table may not exist yet — see CLAUDE.md for setup SQL).</p>';
        }
    }

    async function loadHistoryReport(reportId) {
        try {
            const res = await fetch(`/api/reports/${reportId}`);
            const report = await res.json();
            if (!report || !report.results) { alert('Report data not found.'); return; }

            resetReport();
            document.querySelector('[data-target="report"]').click();

            // Re-render each agent result from saved data
            for (const [persona, content] of Object.entries(report.results)) {
                renderAgentResult({ persona, name: persona, emoji: '📋', status: 'success', content });
            }

            // Re-render synthesis if saved
            if (report.synthesis_content) {
                renderAgentResult({ persona: 'synthesis', name: 'The Verdict', emoji: '🎯', status: 'success', content: report.synthesis_content });
            }

            const statusText = document.getElementById('discovery-status-text');
            if (statusText) statusText.innerText = `Loaded from history · ${report.github_url}`;
        } catch (e) {
            alert('Could not load this report.');
        }
    }

    // Reload history every time the history view is activated
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === 'history') {
            btn.addEventListener('click', loadHistory);
        }
    });

    // ─────────────────────────────────────────
    // Download Full Report
    // ─────────────────────────────────────────
    document.getElementById('download-full-report-btn')?.addEventListener('click', () => {
        const parts = [];
        const githubUrl = state.lastAnalyzedUrl || 'Unknown repository';
        parts.push(`# SDLC Discovery Report\n**Repository:** ${githubUrl}\n**Generated:** ${new Date().toLocaleString()}\n\n---\n`);

        for (const [persona, content] of Object.entries(state.reportContents)) {
            const config = state.personaConfigs[persona] || { name: persona, emoji: '🤖' };
            parts.push(`\n\n# ${config.emoji} ${config.name}\n\n${content}\n\n---`);
        }

        if (!parts.length) { alert('No report content to download yet. Run an analysis first.'); return; }

        const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sdlc-discovery-report-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // ─────────────────────────────────────────
    // Team Kickoff Pack Generator
    // ─────────────────────────────────────────
    document.getElementById('generate-kickoff-btn')?.addEventListener('click', async () => {
        const synthesisContent = state.reportContents['synthesis'];
        if (!synthesisContent) {
            alert('Please complete a full analysis first (the Synthesis / Verdict agent must finish).');
            return;
        }

        const btn = document.getElementById('generate-kickoff-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Generating Kickoff Pack...';

        // Build agent summaries (first 500 chars of each)
        const agentSummaries = {};
        for (const [persona, content] of Object.entries(state.reportContents)) {
            if (persona !== 'synthesis' && content) {
                agentSummaries[persona] = content.substring(0, 500);
            }
        }

        try {
            const res = await fetch('/api/generate-kickoff-pack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    synthesis_content: synthesisContent,
                    agent_summaries: agentSummaries,
                    github_url: state.lastAnalyzedUrl || null,
                    business_context: collectBusinessContext() || null
                })
            });

            const data = await res.json();
            if (!res.ok) {
                alert(`Error: ${data.detail}`);
                return;
            }

            const kickoffCard = document.getElementById('report-kickoff');
            const kickoffContent = document.getElementById('kickoff-content');
            if (kickoffCard && kickoffContent) {
                kickoffContent.innerHTML = simpleMarkdown(data.content);
                kickoffCard.style.display = 'block';
                kickoffCard.classList.add('fade-in');
                kickoffCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // Store for download
                state.reportContents['kickoff'] = data.content;

                // Add download button to kickoff card header
                const header = kickoffCard.querySelector('.report-card-header');
                if (header && !header.querySelector('.kickoff-dl-btn')) {
                    const dlBtn = document.createElement('button');
                    dlBtn.className = 'kickoff-dl-btn secondary-btn btn-sm';
                    dlBtn.innerText = '⬇️ Download Pack';
                    dlBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const blob = new Blob([data.content], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'team-kickoff-pack.md';
                        a.click();
                        URL.revokeObjectURL(url);
                    });
                    header.appendChild(dlBtn);
                }
            }
        } catch (e) {
            alert('Network error generating kickoff pack.');
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.textContent = '🚀 Generate Team Kickoff Pack';
        }
    });

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
    // File / Text Analysis via Full SSE Fleet
    // ─────────────────────────────────────────
    const analyzeBtn = document.getElementById('analyze-btn');
    const assetInput = document.getElementById('asset-input');
    const folderUpload = document.getElementById('folder-upload');
    const fileListEl = document.getElementById('file-list');

    // Show selected file count when folder is chosen
    folderUpload?.addEventListener('change', () => {
        const count = folderUpload.files?.length || 0;
        if (fileListEl) {
            fileListEl.textContent = count > 0 ? `${count} file(s) selected` : '';
        }
    });

    analyzeBtn?.addEventListener('click', async () => {
        const payloadText = assetInput.value.trim();
        const uploadedFiles = folderUpload?.files;
        if(!payloadText && (!uploadedFiles || uploadedFiles.length === 0)) {
            alert("Please provide input text or upload files.");
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = 'Launching Fleet... <span class="loader" style="display:inline-block;"></span>';

        resetReport();
        document.querySelector('[data-target="report"]').click();

        const additionalContext = collectBusinessContext();

        const formData = new FormData();
        if (state.geminiKey) formData.append('gemini_api_key', state.geminiKey);
        if (payloadText) formData.append('text_context', payloadText);
        if (additionalContext) formData.append('additional_context', additionalContext);
        if (state.activeClient) formData.append('client_id', state.activeClient);
        if (uploadedFiles) {
            for (const f of uploadedFiles) formData.append('files', f);
        }

        try {
            const response = await fetch('/api/analyze-files', { method: 'POST', body: formData });
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
                        handleSSEEvent(eventType, line.substring(6).trim());
                        eventType = null;
                    }
                }
            }
        } catch (e) {
            console.error("File analysis error", e);
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Run Legacy Analysis';
        }
    });

    // ═══════════════════════════════════════════════════════════
    // MEETING ROOM
    // ═══════════════════════════════════════════════════════════

    // Agent seat order around the table (16 total: 15 personas + synthesis)
    const MEETING_AGENT_ORDER = [
        'architect', 'ba', 'qa', 'security', 'tech_docs',
        'data_engineering', 'devops', 'product_management', 'ui_ux',
        'compliance', 'secops', 'performance_engineer', 'cost_analyst',
        'api_designer', 'tech_lead', 'synthesis'
    ];

    // Voice fingerprints — distinct pitch/rate per agent so they sound different
    const VOICE_PROFILES = {
        architect:           { pitch: 0.85, rate: 0.90 },
        ba:                  { pitch: 1.10, rate: 1.00 },
        qa:                  { pitch: 1.00, rate: 1.05 },
        security:            { pitch: 0.78, rate: 0.85 },
        tech_docs:           { pitch: 1.05, rate: 0.95 },
        data_engineering:    { pitch: 0.90, rate: 1.00 },
        devops:              { pitch: 0.95, rate: 1.10 },
        product_management:  { pitch: 1.15, rate: 1.02 },
        ui_ux:               { pitch: 1.20, rate: 0.95 },
        compliance:          { pitch: 0.82, rate: 0.85 },
        secops:              { pitch: 0.78, rate: 0.88 },
        performance_engineer:{ pitch: 0.95, rate: 1.08 },
        cost_analyst:        { pitch: 1.02, rate: 1.00 },
        api_designer:        { pitch: 1.08, rate: 1.02 },
        tech_lead:           { pitch: 0.88, rate: 0.90 },
        synthesis:           { pitch: 0.72, rate: 0.83 },
    };

    const meetingState = {
        phase: 'idle',       // idle | loading | opening | debate | qa
        isMuted: false,
        speed: 1.0,
        currentUtterance: null,
        isPaused: false,
        openings: {},        // persona_key → spoken text
        debateTurns: [],     // [{speaker, name, emoji, text}]
        agentReports: {},    // persona_key → {name, emoji, content}
        skipRequested: false,
    };

    // ── Helpers ──────────────────────────────────────────────

    function getMeetingAgentConfig(key) {
        return state.personaConfigs[key] || { name: key, emoji: '🤖' };
    }

    function buildAgentReportsPayload() {
        const payload = {};
        for (const [key, content] of Object.entries(state.reportContents)) {
            const cfg = getMeetingAgentConfig(key);
            payload[key] = { name: cfg.name || key, emoji: cfg.emoji || '🤖', content };
        }
        return payload;
    }

    // ── Conference table rendering ────────────────────────────

    function renderConferenceTable() {
        const ring = document.getElementById('mr-agents-ring');
        if (!ring) return;
        ring.innerHTML = '';

        const available = MEETING_AGENT_ORDER.filter(k => state.reportContents[k]);
        const total = available.length;

        // Ellipse parameters (% of .mr-table-wrap)
        const cx = 50, cy = 46, rx = 42, ry = 33;

        available.forEach((key, i) => {
            const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
            const x = cx + rx * Math.cos(angle);
            const y = cy + ry * Math.sin(angle);

            const cfg = getMeetingAgentConfig(key);
            const isSynthesis = key === 'synthesis';

            const seat = document.createElement('div');
            seat.className = `mr-agent-seat${isSynthesis ? ' mr-seat-synthesis' : ''}`;
            seat.id = `mr-seat-${key}`;
            seat.style.left = `${x}%`;
            seat.style.top = `${y}%`;
            seat.innerHTML = `
                <div class="mr-avatar" data-key="${key}" title="${cfg.name || key}">
                    <span class="mr-av-emoji">${cfg.emoji || '🤖'}</span>
                </div>
                <div class="mr-av-name">${(cfg.name || key).replace('Solutions ', '').replace(' Engineer', '').replace(' Analyst', '').replace(' Manager', '').replace(' Designer', '').replace(' Lead', '')}</div>
            `;
            // Click to jump to their report
            seat.querySelector('.mr-avatar').addEventListener('click', () => {
                navigateToView('report');
                setTimeout(() => {
                    const card = document.getElementById(`report-${key}`);
                    if (card) card.scrollIntoView({ behavior: 'smooth' });
                }, 150);
            });
            ring.appendChild(seat);
        });
    }

    // ── TTS ──────────────────────────────────────────────────

    function getVoices() {
        return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    }

    // Pick a stable voice for an agent — varies by what the browser has
    function pickVoice(key) {
        const voices = getVoices();
        if (!voices.length) return null;
        // Prefer English voices
        const eng = voices.filter(v => v.lang.startsWith('en'));
        const pool = eng.length ? eng : voices;
        // Deterministic selection by agent index
        const idx = MEETING_AGENT_ORDER.indexOf(key);
        return pool[idx % pool.length] || null;
    }

    function speak(text, agentKey, onEnd) {
        if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
        window.speechSynthesis.cancel();

        if (meetingState.isMuted) { if (onEnd) onEnd(); return; }

        const utter = new SpeechSynthesisUtterance(text);
        const profile = VOICE_PROFILES[agentKey] || { pitch: 1.0, rate: 1.0 };
        utter.pitch = profile.pitch;
        utter.rate = profile.rate * meetingState.speed;
        const voice = pickVoice(agentKey);
        if (voice) utter.voice = voice;

        utter.onend = () => { meetingState.currentUtterance = null; if (onEnd) onEnd(); };
        utter.onerror = () => { meetingState.currentUtterance = null; if (onEnd) onEnd(); };

        meetingState.currentUtterance = utter;
        window.speechSynthesis.speak(utter);
    }

    function stopSpeaking() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        meetingState.currentUtterance = null;
    }

    // ── UI helpers ───────────────────────────────────────────

    function highlightSpeaker(key) {
        document.querySelectorAll('.mr-agent-seat').forEach(el => el.classList.remove('mr-speaking'));
        if (key) {
            const seat = document.getElementById(`mr-seat-${key}`);
            if (seat) {
                seat.classList.add('mr-speaking');
                seat.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    function updateSpeechPanel(emoji, name, text) {
        const emojiEl = document.getElementById('mr-speaker-emoji');
        const nameEl = document.getElementById('mr-speaker-name');
        const textEl = document.getElementById('mr-speech-text');
        const dots = document.getElementById('mr-speaking-dots');
        if (emojiEl) emojiEl.textContent = emoji;
        if (nameEl) nameEl.textContent = name;
        if (textEl) textEl.textContent = text;
        if (dots) dots.style.display = meetingState.isMuted ? 'none' : 'inline-flex';
    }

    function addToTranscript(emoji, name, text) {
        const log = document.getElementById('mr-transcript-log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'mr-transcript-entry';
        entry.innerHTML = `<span class="mr-tr-emoji">${emoji}</span><div><strong class="mr-tr-name">${name}</strong><p class="mr-tr-text">${text}</p></div>`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    function addToQALog(question, agentEmoji, agentName, answer) {
        const log = document.getElementById('mr-qa-log');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'mr-qa-entry';
        entry.innerHTML = `
            <div class="mr-qa-q"><span>👤 You</span><p>${question}</p></div>
            <div class="mr-qa-a"><span>${agentEmoji} ${agentName}</span><p>${answer}</p></div>
        `;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    function setPhaseActive(phase) {
        ['openings', 'debate', 'qa'].forEach(p => {
            const el = document.getElementById(`mr-phase-${p}`);
            if (el) el.classList.toggle('mr-phase-active', p === phase);
        });
    }

    function setMeetingControls(phase) {
        const beginBtn = document.getElementById('mr-begin-btn');
        const pauseBtn = document.getElementById('mr-pause-btn');
        const skipBtn = document.getElementById('mr-skip-btn');
        const qaPanel = document.getElementById('mr-qa-panel');

        if (phase === 'idle') {
            if (beginBtn) { beginBtn.style.display = ''; beginBtn.disabled = false; beginBtn.textContent = '▶ Begin Meeting'; }
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (skipBtn) skipBtn.style.display = 'none';
            if (qaPanel) qaPanel.style.display = 'none';
        } else if (phase === 'loading') {
            if (beginBtn) { beginBtn.style.display = ''; beginBtn.disabled = true; beginBtn.textContent = '⏳ Generating...'; }
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (skipBtn) skipBtn.style.display = 'none';
        } else if (phase === 'opening' || phase === 'debate') {
            if (beginBtn) beginBtn.style.display = 'none';
            if (pauseBtn) pauseBtn.style.display = '';
            if (skipBtn) skipBtn.style.display = '';
            if (qaPanel) qaPanel.style.display = 'none';
        } else if (phase === 'qa') {
            if (beginBtn) beginBtn.style.display = 'none';
            if (pauseBtn) pauseBtn.style.display = 'none';
            if (skipBtn) skipBtn.style.display = 'none';
            if (qaPanel) { qaPanel.style.display = ''; }
        }
    }

    // ── Sequential playback of an array of turns ─────────────

    function playTurns(turns, onAllDone) {
        let i = 0;
        function playNext() {
            if (meetingState.isPaused) {
                // Poll until unpaused
                setTimeout(playNext, 300);
                return;
            }
            if (i >= turns.length) {
                highlightSpeaker(null);
                document.getElementById('mr-speaking-dots').style.display = 'none';
                if (onAllDone) onAllDone();
                return;
            }
            const turn = turns[i++];
            meetingState.skipRequested = false;

            highlightSpeaker(turn.speaker);
            updateSpeechPanel(turn.emoji, turn.name, turn.text);
            addToTranscript(turn.emoji, turn.name, turn.text);

            speak(turn.text, turn.speaker, () => {
                // Small gap between speakers
                setTimeout(playNext, meetingState.skipRequested ? 0 : 600);
            });

            // If skip requested, cancel current utterance and advance
            const checkSkip = setInterval(() => {
                if (meetingState.skipRequested) {
                    clearInterval(checkSkip);
                    stopSpeaking();
                }
            }, 100);
        }
        playNext();
    }

    // ── Phase orchestration ───────────────────────────────────

    async function startOpeningCeremony() {
        setMeetingControls('loading');
        updateSpeechPanel('⏳', 'Generating opening statements...', 'Calling the AI to prepare each agent\'s spoken introduction. This takes about 10 seconds...');

        // Fetch openings
        const contentPayload = {};
        for (const [k, v] of Object.entries(state.reportContents)) {
            contentPayload[k] = v;
        }

        try {
            const res = await fetch('/api/meeting/openings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent_reports: contentPayload })
            });
            const data = await res.json();
            meetingState.openings = data.openings || {};
        } catch(e) {
            // Fallback: use first line of each report
            for (const [k, content] of Object.entries(state.reportContents)) {
                const cfg = getMeetingAgentConfig(k);
                const line = content.split('\n').find(l => l.trim().length > 20) || 'Analysis complete.';
                meetingState.openings[k] = `I am the ${cfg.name || k}. ${line.replace(/[#*_]/g, '').trim().substring(0, 200)}`;
            }
        }

        // Build turns from openings in seat order
        const openingTurns = MEETING_AGENT_ORDER
            .filter(k => meetingState.openings[k] && state.reportContents[k])
            .map(k => {
                const cfg = getMeetingAgentConfig(k);
                return { speaker: k, name: cfg.name || k, emoji: cfg.emoji || '🤖', text: meetingState.openings[k] };
            });

        meetingState.phase = 'opening';
        setPhaseActive('openings');
        setMeetingControls('opening');

        // Clear transcript
        const log = document.getElementById('mr-transcript-log');
        if (log) log.innerHTML = '';

        playTurns(openingTurns, startDebate);
    }

    async function startDebate() {
        meetingState.phase = 'loading_debate';
        setMeetingControls('loading');
        updateSpeechPanel('🤝', 'Generating expert debate...', 'The AI is writing a cross-domain debate based on all agent findings. This may take 15-20 seconds...');

        try {
            const res = await fetch('/api/meeting/debate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent_reports: buildAgentReportsPayload() })
            });
            const data = await res.json();
            meetingState.debateTurns = data.turns || [];
        } catch(e) {
            meetingState.debateTurns = [{
                speaker: 'synthesis', name: 'The Verdict', emoji: '🎯',
                text: 'I have reviewed all the analyses. The consensus is clear: prioritise security hardening alongside the architectural refactor, with cost governance integrated from day one. The team is aligned.'
            }];
        }

        meetingState.phase = 'debate';
        setPhaseActive('debate');
        setMeetingControls('debate');
        playTurns(meetingState.debateTurns, openQAMode);
    }

    function openQAMode() {
        meetingState.phase = 'qa';
        setPhaseActive('qa');
        setMeetingControls('qa');
        highlightSpeaker(null);
        updateSpeechPanel('💬', 'Q&A Mode Active', 'The meeting is open for questions. Type below and the most relevant expert will answer.');
        document.getElementById('mr-speaking-dots').style.display = 'none';
    }

    // ── Q&A question handling ─────────────────────────────────

    async function handleMeetingQuestion() {
        const input = document.getElementById('mr-question-input');
        const question = input?.value.trim();
        if (!question) return;
        input.value = '';

        const askBtn = document.getElementById('mr-ask-btn');
        if (askBtn) { askBtn.disabled = true; askBtn.textContent = '⏳'; }

        updateSpeechPanel('🤔', 'Routing question...', `"${question}"`);

        try {
            const res = await fetch('/api/meeting/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question,
                    agent_reports: buildAgentReportsPayload()
                })
            });
            const data = await res.json();

            highlightSpeaker(data.agent_key);
            updateSpeechPanel(data.emoji, data.name, data.answer);
            addToQALog(question, data.emoji, data.name, data.answer);
            speak(data.answer, data.agent_key, () => {
                highlightSpeaker(null);
                updateSpeechPanel('💬', 'Q&A Mode Active', 'Ask another question...');
                document.getElementById('mr-speaking-dots').style.display = 'none';
            });
        } catch(e) {
            updateSpeechPanel('⚠️', 'Error', 'Failed to route question. Please try again.');
        } finally {
            if (askBtn) { askBtn.disabled = false; askBtn.textContent = 'Ask →'; }
        }
    }

    // ── Navigation helper (re-use existing nav) ───────────────

    function navigateToView(target) {
        const btn = document.querySelector(`.nav-btn[data-target="${target}"]`);
        if (btn) btn.click();
    }

    // ── Wire up meeting room events ───────────────────────────

    function initMeetingRoom() {
        // Render table with current report contents
        const repoLabel = document.getElementById('mr-repo-label');
        if (repoLabel) repoLabel.textContent = state.lastAnalyzedUrl || 'Analysis loaded';
        renderConferenceTable();
        setMeetingControls('idle');
        meetingState.phase = 'idle';
        meetingState.isPaused = false;

        // Reset transcript
        const log = document.getElementById('mr-transcript-log');
        if (log) log.innerHTML = '';
        const qaLog = document.getElementById('mr-qa-log');
        if (qaLog) qaLog.innerHTML = '';

        updateSpeechPanel('🎙️', 'Ready to begin', 'Click "Begin Meeting" to start. All 16 experts will deliver opening statements, then debate their findings, then answer your questions.');
        document.getElementById('mr-speaking-dots').style.display = 'none';

        // Reset phase bar
        ['openings', 'debate', 'qa'].forEach(p => {
            const el = document.getElementById(`mr-phase-${p}`);
            if (el) el.classList.remove('mr-phase-active');
        });
    }

    // Begin button
    document.getElementById('mr-begin-btn')?.addEventListener('click', () => {
        if (meetingState.phase === 'idle') startOpeningCeremony();
    });

    // Pause / resume
    document.getElementById('mr-pause-btn')?.addEventListener('click', () => {
        meetingState.isPaused = !meetingState.isPaused;
        const btn = document.getElementById('mr-pause-btn');
        if (meetingState.isPaused) {
            stopSpeaking();
            btn.textContent = '▶ Resume';
        } else {
            btn.textContent = '⏸ Pause';
        }
    });

    // Skip current speaker
    document.getElementById('mr-skip-btn')?.addEventListener('click', () => {
        meetingState.skipRequested = true;
        stopSpeaking();
    });

    // Mute toggle
    document.getElementById('mr-mute-btn')?.addEventListener('click', () => {
        meetingState.isMuted = !meetingState.isMuted;
        const btn = document.getElementById('mr-mute-btn');
        btn.textContent = meetingState.isMuted ? '🔇 Voice Off' : '🔊 Voice On';
        if (meetingState.isMuted) stopSpeaking();
    });

    // Speed control
    document.getElementById('mr-speed')?.addEventListener('input', (e) => {
        meetingState.speed = parseFloat(e.target.value);
        const label = document.getElementById('mr-speed-val');
        if (label) label.textContent = `${meetingState.speed.toFixed(1)}×`;
    });

    // Q&A ask button + Enter key
    document.getElementById('mr-ask-btn')?.addEventListener('click', handleMeetingQuestion);
    document.getElementById('mr-question-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleMeetingQuestion();
    });

    // Enter meeting room button (in report view)
    document.getElementById('enter-meeting-btn')?.addEventListener('click', () => {
        navigateToView('meeting');
        setTimeout(initMeetingRoom, 100);
    });

    // Nav button for meeting
    document.getElementById('nav-meeting-btn')?.addEventListener('click', () => {
        // initMeetingRoom called by the nav click event (view switch)
        setTimeout(initMeetingRoom, 100);
    });

    // Show meeting room button & nav when analysis completes
    function revealMeetingRoom() {
        const meetingBtn = document.getElementById('enter-meeting-btn');
        const navBtn = document.getElementById('nav-meeting-btn');
        if (meetingBtn) meetingBtn.style.display = '';
        if (navBtn) navBtn.style.display = '';
    }

    // Hook into the analysis complete signal
    const _origHandleSSE = handleSSEEvent;
    // Patch: monitor for synthesis completion to reveal meeting room
    const _origRenderAgentResult = window._renderAgentResult;

    // Watch for synthesis result in renderAgentResult calls
    const _origStatusComplete = updateFleetStatusMessage;

    // Simple approach: watch doneCount hitting total
    function checkRevealMeeting() {
        const doneCount = document.querySelectorAll('.agent-status-card.done').length;
        if (doneCount >= 16) revealMeetingRoom();
    }

    // Poll briefly after each agent result — stops once triggered
    const meetingRevealObserver = new MutationObserver(() => {
        checkRevealMeeting();
    });
    const statusGrid = document.getElementById('agent-status-grid');
    if (statusGrid) {
        meetingRevealObserver.observe(statusGrid, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    // Load voices (Chrome needs this triggered on user interaction)
    if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

});  // end DOMContentLoaded
