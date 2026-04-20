import { getAvatarSVG } from './avatars.js';

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

    /** Phase 6 — fleet session id for confidence Q&A */
    let _fleetSessionId = null;

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
            renderHIWAvatarGallery();
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

        // Phase 5 — frugal mode: skip OutSystems agents if toggled.
        const frugalToggle = document.getElementById('frugal-mode-toggle');
        const skipPersonas = (frugalToggle && frugalToggle.checked)
            ? ['outsystems_architect', 'outsystems_migration']
            : null;

        try {
            const response = await fetch('/api/analyze-repo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    github_url: githubUrl,
                    gemini_api_key: state.geminiKey,
                    client_id: state.activeClient || null,
                    project_id: state.selectedProjectId || null,
                    additional_context: additionalContext || null,
                    skip_personas: skipPersonas,
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

    // ─────────────────────────────────────────
    // Mode Switcher (Repository ↔ Topic)
    // ─────────────────────────────────────────
    const modeTabs = document.querySelectorAll('.mode-tab');
    const modePanels = document.querySelectorAll('.mode-panel');
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            modeTabs.forEach(t => {
                const isActive = t.dataset.mode === mode;
                t.classList.toggle('active', isActive);
                t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            modePanels.forEach(p => {
                p.classList.toggle('hidden', p.dataset.mode !== mode);
            });
        });
    });

    // ─────────────────────────────────────────
    // Topic Mode Fleet Launch
    // ─────────────────────────────────────────
    const analyzeTopicBtn = document.getElementById('analyze-topic-btn');
    const topicLoader = document.getElementById('topic-loader');

    async function streamFleetRun(url, body, button, loader) {
        if (button) button.disabled = true;
        if (loader) loader.style.display = 'inline-block';

        resetReport();
        document.querySelector('[data-target="report"]').click();

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const err = await response.json();
                handleSSEEvent('error', JSON.stringify({ message: err.detail || 'Request failed' }));
                return;
            }

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
            console.error('Discovery error', e);
            handleSSEEvent('error', JSON.stringify({ message: String(e) }));
        } finally {
            if (button) button.disabled = false;
            if (loader) loader.style.display = 'none';
        }
    }

    analyzeTopicBtn?.addEventListener('click', async () => {
        const topic = document.getElementById('topic-input')?.value.trim();
        const urlsRaw = document.getElementById('topic-urls')?.value || '';
        const repoUrl = document.getElementById('topic-repo')?.value.trim();

        const urls = urlsRaw
            .split(/\r?\n/)
            .map(u => u.trim())
            .filter(Boolean);

        if (!topic) {
            alert('Please describe the topic you want investigated.');
            return;
        }
        if (urls.length === 0 && !repoUrl) {
            alert('Please provide at least one source URL, or a reference repository.');
            return;
        }

        const additionalContext = collectBusinessContext();

        // Capture topic so the build-pack compiler can re-use it after synthesis.
        state.currentTopic = topic;
        state.currentBusinessContext = additionalContext || '';

        const frugalToggle = document.getElementById('frugal-mode-toggle');
        const skipPersonas = (frugalToggle && frugalToggle.checked)
            ? ['outsystems_architect', 'outsystems_migration']
            : null;

        await streamFleetRun(
            '/api/analyze-topic',
            {
                topic,
                urls,
                github_url: repoUrl || null,
                gemini_api_key: state.geminiKey,
                client_id: state.activeClient || null,
                project_id: state.selectedProjectId || null,
                additional_context: additionalContext || null,
                skip_personas: skipPersonas,
            },
            analyzeTopicBtn,
            topicLoader,
        );
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
                        // Force-mark any cards still spinning as done (their result
                        // events may have been lost mid-stream) and reveal meeting room
                        document.querySelectorAll('.agent-status-card:not(.done)').forEach(card => {
                            card.classList.add('done');
                            const stateEl = card.querySelector('.agent-state');
                            if (stateEl) stateEl.textContent = 'READY';
                            const spinner = card.querySelector('.thinking-spinner');
                            if (spinner) spinner.remove();
                        });
                        revealMeetingRoom();
                    }, 500);
                }
            }

            if (eventType === 'agent_result') {
                renderAgentResult(data);
                // Dynamic total: 19 when full fleet, 17 in frugal mode (skip 2 OS agents).
                const frugal = document.getElementById('frugal-mode-toggle');
                const total = (frugal && frugal.checked) ? 17 : 19;
                const doneCount = document.querySelectorAll('.agent-status-card.done').length;
                const progress = (doneCount / total) * 100;
                const progressFill = document.getElementById('fleet-progress-fill');
                if (progressFill) progressFill.style.width = `${progress}%`;
                // Synthesis result = everything is done regardless of card state
                if (data.persona === 'synthesis') {
                    revealMeetingRoom();
                    revealBuildPackBanner();
                }
            }

            if (eventType === 'agent_update') {
                // Recon pre-pass has no card — surface its progress in the fleet status bar
                if (data.key === 'recon') {
                    updateFleetStatusMessage(
                        data.status === 'complete'
                            ? `🔍 Reconnaissance complete — launching ${Object.keys(state.personaConfigs).length} agents...`
                            : `🔍 ${data.sub_status || 'Running codebase reconnaissance...'}`
                    );
                    // Capture recon JSON for downstream tools (build pack compiler, etc.)
                    if (data.recon) state.reconData = data.recon;
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

            // Phase 6 — confidence check events
            if (eventType === 'confidence_report') {
                renderConfidenceReport(data);
            }
            if (eventType === 'awaiting_answers') {
                showConfidenceQA(data);
            }

            // Phase 7B — specialist agent proposals
            if (eventType === 'specialist_proposals') {
                renderSpecialistProposals(data);
            }

            // Phase 8 — situational Opus escalation announcement
            if (eventType === 'synthesis_escalated') {
                state.lastEscalation = data;
                const msg = `⚡ Synthesis escalated to Opus — ${data.reason}`;
                console.log('[escalation]', msg, data);
                updateFleetStatusMessage(msg);
            }

            // Phase 9 — cross-domain flags raised between agents
            if (eventType === 'cross_domain_flags') {
                state.crossDomainFlags = data.flags || [];
                renderCrossDomainFlags(data);
                updateFleetStatusMessage(`🔥 ${data.count} cross-domain flag(s) raised — synthesis will resolve`);
            }

            // Phase 9 closed-loop — synthesis ruled on each flag
            if (eventType === 'flag_resolutions') {
                state.flagResolutions = data.resolutions || [];
                renderCrossDomainFlags({ flags: data.resolutions || [] });
                const msg = data.resolved_count >= data.total
                    ? `✅ All ${data.total} cross-domain flag(s) resolved by synthesis`
                    : `🔥 ${data.resolved_count}/${data.total} cross-domain flag(s) resolved — review verdict`;
                updateFleetStatusMessage(msg);
            }

            // Phase 5 — live cost display when a run finishes.
            if (eventType === 'usage_summary') {
                state.lastUsageSummary = data;
                const costUsd = data.total_cost_usd || 0;
                if (costUsd > 0) {
                    const costMsg = `Run cost: $${costUsd.toFixed(4)} (` +
                        `${(data.total_input_tokens || 0).toLocaleString()} in / ` +
                        `${(data.total_output_tokens || 0).toLocaleString()} out` +
                        (data.total_cache_read_tokens > 0
                            ? ` / ${data.total_cache_read_tokens.toLocaleString()} cache hits`
                            : '') +
                        ')';
                    console.log('[usage]', costMsg, data);
                    updateFleetStatusMessage(costMsg);
                }
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
                // Phase 8 — synthesis escalation badge
                if (result.persona === 'synthesis' && result.escalated) {
                    const banner = document.createElement('div');
                    banner.className = 'opus-escalation-banner';
                    banner.innerHTML = `
                        <span class="opus-escalation-icon">⚡</span>
                        <div class="opus-escalation-text">
                            <strong>Escalated to Claude Opus 4.6</strong>
                            <span>${escapeHTML(result.escalation_reason || 'Confidence-driven escalation triggered')}</span>
                        </div>
                        <span class="opus-escalation-cost-hint" title="Opus is ~5× the cost of Sonnet">~5× cost</span>
                    `;
                    contentEl.insertBefore(banner, contentEl.firstChild);
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
        // Reset confidence panel from previous run
        const confPanel = document.getElementById('confidence-panel');
        if (confPanel) confPanel.classList.add('hidden');
        const confQA = document.getElementById('confidence-qa');
        if (confQA) confQA.classList.add('hidden');
        // Reset cross-domain flags panel (Phase 9)
        const cdfPanel = document.getElementById('cross-domain-flags-panel');
        if (cdfPanel) cdfPanel.style.display = 'none';
        state.crossDomainFlags = [];
        state.flagResolutions = [];
        _fleetSessionId = null;
        updateFleetStatusMessage('');
        state.reportContents = {};
        state.lastAnalyzedUrl = null;
        state.reconData = null;
        state.currentTopic = '';
        resetBuildPackBanner();
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
                revealBuildPackBanner();
            }

            // If this is a topic-mode run, recover the topic from the storage id
            if (typeof report.github_url === 'string' && report.github_url.startsWith('topic://')) {
                state.currentTopic = report.github_url.replace(/^topic:\/\//, '').trim();
            } else {
                state.currentTopic = '';
            }
            state.lastAnalyzedUrl = report.github_url;

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
    // Team Kickoff Pack Generator (SSE-streamed multi-doc)
    // ─────────────────────────────────────────
    const KICKOFF_PACK_STAGES = [
        'analyzing',
        'compiling_spec',
        'generating_files',
        'zipping',
        'complete',
    ];

    function setKickoffStage(stage) {
        const idx = KICKOFF_PACK_STAGES.indexOf(stage);
        if (idx < 0) return;
        document.querySelectorAll('.kickoff-pack-progress__stage').forEach(elNode => {
            const elIdx = KICKOFF_PACK_STAGES.indexOf(elNode.dataset.stage);
            elNode.classList.remove('active', 'done');
            if (elIdx < idx) elNode.classList.add('done');
            else if (elIdx === idx) elNode.classList.add('active');
        });
    }

    function setKickoffStatus(message, kind = '') {
        const status = document.getElementById('kickoff-pack-status');
        if (!status) return;
        status.textContent = message || '';
        status.className = 'kickoff-pack-status' + (kind ? ' ' + kind : '');
    }

    function resetKickoffPanel() {
        const card = document.getElementById('report-kickoff');
        const progress = document.getElementById('kickoff-pack-progress');
        const link = document.getElementById('kickoff-pack-download-link');
        const fileList = document.getElementById('kickoff-pack-files');

        if (card) {
            card.style.display = 'block';
            card.classList.add('fade-in');
        }
        if (progress) {
            progress.classList.remove('hidden');
            progress.querySelectorAll('.kickoff-pack-progress__stage').forEach(elNode => {
                elNode.classList.remove('active', 'done');
            });
        }
        if (link) {
            link.classList.add('hidden');
            link.removeAttribute('href');
        }
        if (fileList) {
            while (fileList.firstChild) fileList.removeChild(fileList.firstChild);
        }
        setKickoffStatus('');
    }

    function fmtKickoffBytes(bytes) {
        if (!bytes && bytes !== 0) return '';
        const units = ['B', 'KB', 'MB'];
        let i = 0, n = bytes;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function appendKickoffFile(fileMeta) {
        const list = document.getElementById('kickoff-pack-files');
        if (!list) return;
        const li = document.createElement('li');
        li.className = 'kickoff-pack-file';
        li.dataset.previewUrl = fileMeta.preview_url || '';
        li.dataset.filename = fileMeta.filename || '';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'kickoff-pack-file__name';
        nameSpan.textContent = fileMeta.filename || '';

        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'kickoff-pack-file__size';
        sizeSpan.textContent = fmtKickoffBytes(fileMeta.size || 0);

        li.appendChild(nameSpan);
        li.appendChild(sizeSpan);
        li.addEventListener('click', () => openKickoffFilePreview(fileMeta));
        list.appendChild(li);
    }

    async function openKickoffFilePreview(fileMeta) {
        const overlay = document.getElementById('kickoff-file-preview-overlay');
        const title = document.getElementById('kickoff-file-preview-title');
        const meta = document.getElementById('kickoff-file-preview-meta');
        const body = document.getElementById('kickoff-file-preview-body');
        if (!overlay || !title || !body) return;

        title.textContent = fileMeta.filename || 'Document preview';
        if (meta) meta.textContent = `${fmtKickoffBytes(fileMeta.size || 0)} · ${fileMeta.preview_url || ''}`;
        body.textContent = 'Loading...';
        overlay.classList.remove('hidden');

        try {
            const res = await fetch(fileMeta.preview_url);
            if (!res.ok) {
                body.textContent = `Could not load file (HTTP ${res.status}).`;
                return;
            }
            const text = await res.text();
            // simpleMarkdown is the project-wide markdown helper; safe text
            // because we generated this file ourselves on the server.
            body.innerHTML = simpleMarkdown(text);
        } catch (e) {
            body.textContent = `Network error loading file: ${e.message || e}`;
        }
    }

    function closeKickoffFilePreview() {
        const overlay = document.getElementById('kickoff-file-preview-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    document.getElementById('kickoff-file-preview-close')?.addEventListener('click', closeKickoffFilePreview);
    document.getElementById('kickoff-file-preview-overlay')?.addEventListener('click', (e) => {
        if (e.target?.id === 'kickoff-file-preview-overlay') closeKickoffFilePreview();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const ov = document.getElementById('kickoff-file-preview-overlay');
            if (ov && !ov.classList.contains('hidden')) closeKickoffFilePreview();
        }
    });

    document.getElementById('generate-kickoff-btn')?.addEventListener('click', async () => {
        const synthesisContent = state.reportContents['synthesis'];
        if (!synthesisContent) {
            alert('Please complete a full analysis first (the Synthesis / Verdict agent must finish).');
            return;
        }

        // Build agent summaries (first 600 chars of each non-synthesis report)
        const agentSummaries = {};
        for (const [persona, content] of Object.entries(state.reportContents)) {
            if (persona !== 'synthesis' && persona !== 'kickoff' && content) {
                agentSummaries[persona] = content.substring(0, 600);
            }
        }

        const btn = document.getElementById('generate-kickoff-btn');
        btn.disabled = true;
        btn.textContent = '⏳ Compiling Kickoff Pack...';

        resetKickoffPanel();
        setKickoffStage('analyzing');
        setKickoffStatus('Starting compilation...');

        // Reveal the card and scroll to it so the user sees progress
        const card = document.getElementById('report-kickoff');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const body = {
            topic: state.currentTopic || '',
            synthesis_content: synthesisContent,
            agent_summaries: agentSummaries,
            github_url: state.lastAnalyzedUrl || null,
            business_context: collectBusinessContext() || null,
            project_id: state.selectedProjectId || null,
        };

        try {
            const response = await fetch('/api/generate-kickoff-pack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const err = await response.json();
                setKickoffStatus(`Error: ${err.detail || 'Request failed'}`, 'error');
                btn.disabled = false;
                btn.textContent = '🚀 Generate Team Kickoff Pack';
                return;
            }

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
                        const raw = line.substring(6).trim();
                        if (!raw) { eventType = null; continue; }
                        let data = {};
                        try { data = JSON.parse(raw); } catch (_) { /* ignore */ }

                        if (eventType === 'status') {
                            if (data.phase) setKickoffStage(data.phase);
                            if (data.message) setKickoffStatus(data.message);
                        } else if (eventType === 'file_ready') {
                            appendKickoffFile({
                                filename: data.filename,
                                size: data.size,
                                preview_url: data.preview_url,
                            });
                        } else if (eventType === 'kickoff_pack_ready') {
                            setKickoffStage('complete');
                            const sizeStr = fmtKickoffBytes(data.total_size || 0);
                            setKickoffStatus(
                                `Kickoff pack ready — ${data.file_count || '?'} files · ${sizeStr}. Click any file to preview, or download the zip.`,
                                'success'
                            );
                            const link = document.getElementById('kickoff-pack-download-link');
                            if (link && data.download_url) {
                                link.href = data.download_url;
                                link.classList.remove('hidden');
                            }
                            // Replace any previously appended files with the canonical list (in case
                            // file_ready ordering produced duplicates).
                            const list = document.getElementById('kickoff-pack-files');
                            if (list && Array.isArray(data.files)) {
                                while (list.firstChild) list.removeChild(list.firstChild);
                                data.files.forEach(appendKickoffFile);
                            }
                        } else if (eventType === 'error') {
                            setKickoffStatus(`Error: ${data.message || 'Kickoff pack generation failed'}`, 'error');
                        }

                        eventType = null;
                    }
                }
            }
        } catch (e) {
            console.error('Kickoff pack error', e);
            setKickoffStatus(`Network error: ${e.message || e}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '🔁 Regenerate Kickoff Pack';
        }
    });

    // ─────────────────────────────────────────
    // Build Pack — compile into downloadable implementation folder
    // ─────────────────────────────────────────
    const BUILD_PACK_STAGES = [
        'analyzing_reports',
        'compiling_spec',
        'generating_files',
        'zipping',
        'complete',
    ];

    function revealBuildPackBanner() {
        const banner = document.getElementById('build-pack-banner');
        if (banner) banner.classList.remove('hidden');
    }

    function resetBuildPackBanner() {
        const banner = document.getElementById('build-pack-banner');
        if (banner) banner.classList.add('hidden');

        const btn = document.getElementById('generate-build-pack-btn');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🛠️ Generate Build Pack';
        }
        const link = document.getElementById('build-pack-download-link');
        if (link) {
            link.classList.add('hidden');
            link.removeAttribute('href');
        }
        const progress = document.getElementById('build-pack-progress');
        if (progress) {
            progress.classList.add('hidden');
            progress.querySelectorAll('.build-pack-progress__stage').forEach(el => {
                el.classList.remove('active', 'done');
            });
        }
        const status = document.getElementById('build-pack-status');
        if (status) {
            status.textContent = '';
            status.className = 'build-pack-status';
        }
    }

    function setBuildPackStage(stage) {
        const idx = BUILD_PACK_STAGES.indexOf(stage);
        if (idx < 0) return;
        const stages = document.querySelectorAll('.build-pack-progress__stage');
        stages.forEach(el => {
            const elStage = el.dataset.stage;
            const elIdx = BUILD_PACK_STAGES.indexOf(elStage);
            el.classList.remove('active', 'done');
            if (elIdx < idx) el.classList.add('done');
            else if (elIdx === idx) el.classList.add('active');
        });
    }

    function setBuildPackStatus(message, kind = '') {
        const status = document.getElementById('build-pack-status');
        if (!status) return;
        status.textContent = message || '';
        status.className = 'build-pack-status' + (kind ? ' ' + kind : '');
    }

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let n = bytes;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    document.getElementById('generate-build-pack-btn')?.addEventListener('click', async () => {
        const synthesisContent = state.reportContents['synthesis'];
        if (!synthesisContent) {
            alert('Run a full analysis first — the Synthesis agent must finish before a build pack can be compiled.');
            return;
        }

        // Collect every completed persona report except synthesis (which goes in its own field)
        const results = {};
        for (const [persona, content] of Object.entries(state.reportContents)) {
            if (persona !== 'synthesis' && persona !== 'kickoff' && content) {
                results[persona] = content;
            }
        }

        const btn = document.getElementById('generate-build-pack-btn');
        const link = document.getElementById('build-pack-download-link');
        const progress = document.getElementById('build-pack-progress');

        btn.disabled = true;
        btn.textContent = '⏳ Compiling Build Pack...';
        link?.classList.add('hidden');
        progress?.classList.remove('hidden');
        progress?.querySelectorAll('.build-pack-progress__stage').forEach(el => el.classList.remove('active', 'done'));
        setBuildPackStage('analyzing_reports');
        setBuildPackStatus('Starting build pack compilation...');

        const body = {
            topic: state.currentTopic || '',
            results,
            synthesis_content: synthesisContent,
            recon_data: state.reconData || null,
            client_context: collectBusinessContext() || state.currentBusinessContext || null,
        };

        try {
            const response = await fetch('/api/generate-build-pack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
                const err = await response.json();
                setBuildPackStatus(`Error: ${err.detail || 'Request failed'}`, 'error');
                btn.disabled = false;
                btn.textContent = '🛠️ Generate Build Pack';
                return;
            }

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
                        const raw = line.substring(6).trim();
                        if (!raw) { eventType = null; continue; }
                        let data = {};
                        try { data = JSON.parse(raw); } catch (_) { /* ignore */ }

                        if (eventType === 'status') {
                            if (data.phase) setBuildPackStage(data.phase);
                            if (data.message) setBuildPackStatus(data.message);
                        } else if (eventType === 'build_pack_ready') {
                            setBuildPackStage('complete');
                            const sizeStr = formatBytes(data.total_size || 0);
                            setBuildPackStatus(
                                `Build pack ready — ${data.file_count || '?'} files · ${sizeStr}. Click "Download Pack" to save.`,
                                'success'
                            );
                            if (link && data.download_url) {
                                link.href = data.download_url;
                                link.classList.remove('hidden');
                            }
                        } else if (eventType === 'error') {
                            setBuildPackStatus(`Error: ${data.message || 'Build pack generation failed'}`, 'error');
                        }

                        eventType = null;
                    }
                }
            }
        } catch (e) {
            console.error('Build pack error', e);
            setBuildPackStatus(`Network error: ${e.message || e}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '🔁 Regenerate Build Pack';
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

    // Agent seat order around the table (19 total: 15 personas + AI Innovation Scout + 2 OutSystems + synthesis)
    const MEETING_AGENT_ORDER = [
        'architect', 'ba', 'qa', 'security', 'tech_docs',
        'data_engineering', 'devops', 'product_management', 'ui_ux',
        'compliance', 'secops', 'performance_engineer', 'cost_analyst',
        'api_designer', 'tech_lead', 'ai_innovation_scout',
        'outsystems_architect', 'outsystems_migration', 'synthesis'
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
        ai_innovation_scout:   { pitch: 1.12, rate: 1.08 },
        outsystems_architect:  { pitch: 0.92, rate: 0.94 },
        outsystems_migration:  { pitch: 1.05, rate: 0.97 },
        synthesis:             { pitch: 0.72, rate: 0.83 },
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

            // Use SVG avatar with emoji fallback
            const avatarSvg = getAvatarSVG(key);
            seat.innerHTML = `
                <div class="mr-avatar mr-avatar-svg" data-key="${key}" title="${cfg.name || key}">
                    ${avatarSvg}
                </div>
                <div class="mr-av-name">${(cfg.name || key).replace('Solutions ', '').replace('OutSystems ', 'OS ').replace(' Engineer', '').replace(' Analyst', '').replace(' Manager', '').replace(' Designer', '').replace(' Lead', '').replace(' Strategist', '')}</div>
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
        if (!window.speechSynthesis) {
            // No TTS available — show text for a readable duration then advance
            const ms = Math.max(3000, Math.min(text.split(' ').length * 300, 12000));
            setTimeout(() => { if (onEnd) onEnd(); }, ms);
            return;
        }
        window.speechSynthesis.cancel();

        if (meetingState.isMuted) {
            // Muted — keep text visible long enough to read (~300ms per word, 3–12s range)
            const ms = Math.max(3000, Math.min(text.split(' ').length * 300, 12000));
            setTimeout(() => { if (onEnd) onEnd(); }, ms);
            return;
        }

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

    function updateSpeechPanel(emoji, name, text, speakerKey) {
        const emojiEl = document.getElementById('mr-speaker-emoji');
        const nameEl = document.getElementById('mr-speaker-name');
        const textEl = document.getElementById('mr-speech-text');
        const dots = document.getElementById('mr-speaking-dots');
        // Show mini SVG avatar in speech header if available
        if (emojiEl) {
            if (speakerKey) {
                const miniSvg = getAvatarSVG(speakerKey);
                emojiEl.innerHTML = miniSvg;
                emojiEl.classList.add('mr-speaker-avatar');
            } else {
                emojiEl.textContent = emoji;
                emojiEl.classList.remove('mr-speaker-avatar');
            }
        }
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
            updateSpeechPanel(turn.emoji, turn.name, turn.text, turn.speaker);
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
            updateSpeechPanel(data.emoji, data.name, data.answer, data.agent_key);
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

        updateSpeechPanel('🎙️', 'Ready to begin', 'Click "Begin Meeting" to start. All 19 experts will deliver opening statements, then debate their findings — the AI Innovation Scout and the OutSystems specialists will challenge traditional build assumptions — then answer your questions.');
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


    // ─────────────────────────────────────────
    // How It Works — Interactive Avatar Gallery
    // ─────────────────────────────────────────

    const AGENT_BRIEFS = {
        architect:            'Evaluates system architecture, designs modernisation roadmaps, and creates Mermaid architecture diagrams.',
        ba:                   'Generates structured Jira-format backlogs with user stories, acceptance criteria, and story points.',
        qa:                   'Audits test coverage, builds risk registers, and designs comprehensive testing strategies.',
        security:             'Performs OWASP Top 10 audits, scans for CVEs, and produces vulnerability registers with CVSS scores.',
        tech_docs:            'Audits documentation coverage, writes ADR templates, runbooks, and identifies onboarding gaps.',
        data_engineering:     'Maps data models, designs zero-downtime migration strategies, and assesses data quality.',
        devops:               'Scores production readiness (0–100), designs CI/CD pipelines, and creates observability blueprints.',
        product_management:   'Builds value maps, KPI dashboards, and Now/Next/Later product roadmaps with ROI analysis.',
        ui_ux:                'Conducts UX audits (8+ findings), maps user journeys, and checks WCAG 2.2 accessibility compliance.',
        compliance:           'Assesses GDPR/HIPAA/SOC 2/PCI-DSS applicability, maps data flows, and identifies compliance gaps.',
        secops:               'Rates security automation maturity (1–5), audits secrets, and designs shift-left security pipelines.',
        performance_engineer: 'Identifies 8+ bottlenecks, analyses scalability cliffs (2x/10x/100x), and designs load testing strategies.',
        cost_analyst:         'Produces 8+ FinOps findings, cloud cost models, and build vs. buy vs. AI cost comparisons.',
        api_designer:         'Audits REST maturity levels, produces OpenAPI 3.1 specs, and designs versioning strategies.',
        tech_lead:            'Rates codebase health (A–F), analyses tech debt across 4 quadrants, and assesses bus factor risk.',
        ai_innovation_scout:  'Researches AI tools and low-code platforms, produces three strategic paths, and challenges build assumptions.',
        outsystems_architect: 'Maps codebase to OutSystems domain model, audits Forge marketplace, and assesses ODC vs O11 fit.',
        outsystems_migration: 'Designs phased migration roadmaps, scores component complexity, and analyses the commercial model.',
        synthesis:            'Reads all agent reports, resolves contradictions with extended thinking, and delivers the unified CTO verdict.',
    };

    const AGENT_CONTEXT_LIMITS = {
        architect: '80K', ba: '60K', qa: '80K', security: '100K', tech_docs: '60K',
        data_engineering: '80K', devops: '80K', product_management: '50K', ui_ux: '70K',
        compliance: '70K', secops: '100K', performance_engineer: '80K', cost_analyst: '50K',
        api_designer: '80K', tech_lead: '60K', ai_innovation_scout: '70K',
        outsystems_architect: '80K', outsystems_migration: '80K', synthesis: 'All reports',
    };

    // Agent display order for the gallery (grouped by category)
    const GALLERY_ORDER = [
        // Core Engineering
        'architect', 'tech_lead', 'api_designer', 'data_engineering',
        // Quality & Security
        'qa', 'security', 'secops', 'performance_engineer',
        // Business & Product
        'ba', 'product_management', 'ui_ux', 'tech_docs',
        // Operations & Governance
        'devops', 'compliance', 'cost_analyst',
        // Innovation & Platform
        'ai_innovation_scout', 'outsystems_architect', 'outsystems_migration',
    ];

    function renderHIWAvatarGallery() {
        const gallery = document.getElementById('hiw-avatar-gallery');
        if (!gallery || !state.personaConfigs) return;

        // Add synthesis manually (not in PERSONA_CONFIGS)
        const allConfigs = { ...state.personaConfigs };
        if (!allConfigs.synthesis) {
            allConfigs.synthesis = { name: 'The Verdict — Synthesis', emoji: '⚖️', model: 'anthropic' };
        }

        gallery.innerHTML = '';

        // Group labels
        const groups = [
            { label: 'Core Engineering', keys: ['architect', 'tech_lead', 'api_designer', 'data_engineering'] },
            { label: 'Quality & Security', keys: ['qa', 'security', 'secops', 'performance_engineer'] },
            { label: 'Business & Product', keys: ['ba', 'product_management', 'ui_ux', 'tech_docs'] },
            { label: 'Operations & Governance', keys: ['devops', 'compliance', 'cost_analyst'] },
            { label: 'Innovation & Platform', keys: ['ai_innovation_scout', 'outsystems_architect', 'outsystems_migration'] },
            { label: 'The Verdict', keys: ['synthesis'] },
        ];

        groups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'hiw-gallery-group';

            const labelEl = document.createElement('div');
            labelEl.className = 'hiw-gallery-group-label';
            labelEl.textContent = group.label;
            groupEl.appendChild(labelEl);

            const gridEl = document.createElement('div');
            gridEl.className = 'hiw-gallery-grid';

            group.keys.forEach(key => {
                const cfg = allConfigs[key];
                if (!cfg) return;

                const model = cfg.model === 'anthropic' ? 'Claude' : 'Gemini';
                const modelClass = cfg.model === 'anthropic' ? 'claude-badge' : 'gemini-badge';
                const isSynthesis = key === 'synthesis';

                const card = document.createElement('div');
                card.className = `hiw-avatar-card${isSynthesis ? ' hiw-avatar-card-synthesis' : ''}`;
                card.dataset.key = key;
                card.innerHTML = `
                    <div class="hiw-avatar-portrait${isSynthesis ? ' hiw-portrait-synthesis' : ''}">
                        ${getAvatarSVG(key)}
                    </div>
                    <div class="hiw-avatar-info">
                        <div class="hiw-avatar-name">${cfg.name || key}</div>
                        <div class="hiw-avatar-badges">
                            <span class="hiw-phase-model ${modelClass}" style="font-size:0.65rem;">${model}</span>
                            <span class="hiw-context-badge">${AGENT_CONTEXT_LIMITS[key] || '?'}</span>
                        </div>
                        <p class="hiw-avatar-brief">${AGENT_BRIEFS[key] || ''}</p>
                    </div>
                    <div class="hiw-avatar-cta">Explore →</div>
                `;
                card.addEventListener('click', () => openAgentDetail(key));
                gridEl.appendChild(card);
            });

            groupEl.appendChild(gridEl);
            gallery.appendChild(groupEl);
        });
    }

    // ── System Prompt Parser ────────────────────

    function parseSystemPrompt(prompt) {
        if (!prompt) return { identity: '', mission: '', checklist: '', deliverables: '', homework: '' };

        const sections = { identity: '', mission: '', checklist: '', deliverables: '', homework: '' };

        // Find section boundaries
        const missionIdx = prompt.search(/\*\*Your Mission\*\*/i);
        const checklistIdx = prompt.search(/\*\*Your Deep Investigation Checklist\*\*/i);
        const deliverablesIdx = prompt.search(/\*\*Your Deliverables[:\*]/i);
        const homeworkIdx = prompt.search(/\*\*Your Homework\*\*/i);

        // Identity: everything before Mission
        if (missionIdx > 0) {
            sections.identity = prompt.substring(0, missionIdx).trim();
        } else {
            // Some prompts may not have explicit **Your Mission** — use first paragraph
            const firstBreak = prompt.indexOf('\n\n');
            if (firstBreak > 0) sections.identity = prompt.substring(0, firstBreak).trim();
        }

        // Mission: from Mission to Checklist
        if (missionIdx >= 0) {
            const end = checklistIdx > missionIdx ? checklistIdx : (deliverablesIdx > missionIdx ? deliverablesIdx : prompt.length);
            sections.mission = prompt.substring(missionIdx, end).trim();
        }

        // Checklist: from Checklist to Deliverables
        if (checklistIdx >= 0) {
            const end = deliverablesIdx > checklistIdx ? deliverablesIdx : (homeworkIdx > checklistIdx ? homeworkIdx : prompt.length);
            sections.checklist = prompt.substring(checklistIdx, end).trim();
        }

        // Deliverables: from Deliverables to Homework
        if (deliverablesIdx >= 0) {
            const end = homeworkIdx > deliverablesIdx ? homeworkIdx : prompt.length;
            sections.deliverables = prompt.substring(deliverablesIdx, end).trim();
        }

        // Homework: everything from Homework to end
        if (homeworkIdx >= 0) {
            sections.homework = prompt.substring(homeworkIdx).trim();
        }

        return sections;
    }

    function promptSectionToHTML(text) {
        if (!text) return '<p class="muted-text">Not available for this agent.</p>';
        // Convert markdown-like formatting to HTML
        return text
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/^### (.+)$/gm, '<h5>$1</h5>')
            .replace(/^## (.+)$/gm, '<h4>$1</h4>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>').replace(/$/, '</p>')
            .replace(/<p><\/p>/g, '')
            .replace(/<p>(<[uh])/g, '$1')
            .replace(/(<\/[uh]\d?>)<\/p>/g, '$1');
    }

    // ── Agent Detail Modal ──────────────────────

    function openAgentDetail(key) {
        const cfg = state.personaConfigs[key] || (key === 'synthesis' ? { name: 'The Verdict — Synthesis', emoji: '⚖️', model: 'anthropic', system_prompt: '' } : null);
        if (!cfg) return;

        const overlay = document.getElementById('agent-detail-overlay');
        const model = cfg.model === 'anthropic' ? 'Claude Sonnet 4.6' : 'Gemini 2.0 Flash';
        const modelClass = cfg.model === 'anthropic' ? 'claude-badge' : 'gemini-badge';

        // Avatar
        document.getElementById('agent-detail-avatar').innerHTML = getAvatarSVG(key);

        // Meta
        document.getElementById('agent-detail-name').textContent = cfg.name || key;
        const modelBadge = document.getElementById('agent-detail-model');
        modelBadge.textContent = model;
        modelBadge.className = `agent-detail-model-badge ${modelClass}`;
        document.getElementById('agent-detail-context').textContent = `Context: ${AGENT_CONTEXT_LIMITS[key] || '?'} chars`;
        document.getElementById('agent-detail-brief').textContent = AGENT_BRIEFS[key] || '';

        // Parse system prompt
        const parsed = parseSystemPrompt(cfg.system_prompt || '');

        document.querySelector('#agent-detail-identity .agent-detail-content').innerHTML = promptSectionToHTML(parsed.identity);
        document.querySelector('#agent-detail-mission .agent-detail-content').innerHTML = promptSectionToHTML(parsed.mission);
        document.querySelector('#agent-detail-checklist .agent-detail-content').innerHTML = promptSectionToHTML(parsed.checklist);
        document.querySelector('#agent-detail-deliverables .agent-detail-content').innerHTML = promptSectionToHTML(parsed.deliverables);
        document.querySelector('#agent-detail-homework .agent-detail-content').innerHTML = promptSectionToHTML(parsed.homework);

        // Show/hide sections that have content
        ['identity', 'mission', 'checklist', 'deliverables', 'homework'].forEach(s => {
            const el = document.getElementById(`agent-detail-${s}`);
            if (el) el.style.display = parsed[s] ? '' : 'none';
        });

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeAgentDetail() {
        const overlay = document.getElementById('agent-detail-overlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    // Modal close handlers
    document.getElementById('agent-detail-close')?.addEventListener('click', closeAgentDetail);
    document.getElementById('agent-detail-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'agent-detail-overlay') closeAgentDetail();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAgentDetail();
    });

    // ─────────────────────────────────────────
    // Projects Workspace (Phase 1)
    // Built with DOM construction (no innerHTML) to keep escape-safety airtight.
    // ─────────────────────────────────────────

    const projectsState = {
        flat: [],
        tree: [],
        activeId: null,
        activeProject: null,
        collapsed: new Set(),
        modalMode: 'create',
        modalParentId: null,
        activeTab: 'overview',
    };

    function $pj(id) { return document.getElementById(id); }

    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null) continue;
            if (k === 'class') node.className = v;
            else if (k === 'dataset') {
                for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
            } else if (k === 'text') {
                node.textContent = v;
            } else if (k === 'on') {
                for (const [evt, handler] of Object.entries(v)) node.addEventListener(evt, handler);
            } else if (k in node) {
                node[k] = v;
            } else {
                node.setAttribute(k, v);
            }
        }
        for (const child of (Array.isArray(children) ? children : [children])) {
            if (child == null || child === false) continue;
            if (typeof child === 'string') node.appendChild(document.createTextNode(child));
            else node.appendChild(child);
        }
        return node;
    }

    function clearChildren(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    async function fetchProjectsTree() {
        try {
            const [flatRes, treeRes] = await Promise.all([
                fetch('/api/projects?flat=true').then(r => r.json()),
                fetch('/api/projects').then(r => r.json()),
            ]);
            projectsState.flat = Array.isArray(flatRes) ? flatRes : [];
            projectsState.tree = Array.isArray(treeRes) ? treeRes : [];
            renderProjectsTree();
        } catch (e) {
            console.error('fetchProjectsTree failed', e);
            const container = $pj('projects-tree');
            if (container) {
                clearChildren(container);
                container.appendChild(el('div', {
                    class: 'projects-tree__empty',
                    text: 'Could not load projects. Check the server logs.',
                }));
            }
        }
    }

    function renderProjectsTree() {
        const container = $pj('projects-tree');
        if (!container) return;
        const filter = ($pj('projects-search')?.value || '').toLowerCase().trim();
        const roots = projectsState.tree;
        clearChildren(container);
        if (!roots.length) {
            container.appendChild(el('div', {
                class: 'projects-tree__empty',
                text: 'No projects yet. Click ＋ New to create one.',
            }));
            return;
        }
        const matches = (node) => {
            if (!filter) return true;
            if ((node.name || '').toLowerCase().includes(filter)) return true;
            return (node.children || []).some(matches);
        };
        const renderNode = (node, depth) => {
            if (!matches(node)) return null;
            const isActive = node.id === projectsState.activeId;
            const hasChildren = (node.children || []).length > 0;
            const collapsed = projectsState.collapsed.has(node.id);
            const isLegacy = (node.metadata || {}).legacy_holder === true;
            const row = el('div', {
                class: 'project-tree-row' + (isActive ? ' active' : ''),
                dataset: { projectId: String(node.id) },
                on: {
                    click: (e) => {
                        if (e.target.dataset.toggle) return;
                        selectProject(node.id);
                    },
                },
            }, [
                el('span', {
                    class: 'project-tree-row__toggle',
                    dataset: hasChildren ? { toggle: String(node.id) } : {},
                    text: hasChildren ? (collapsed ? '▶' : '▼') : '·',
                    on: hasChildren ? {
                        click: (e) => {
                            e.stopPropagation();
                            if (projectsState.collapsed.has(node.id)) projectsState.collapsed.delete(node.id);
                            else projectsState.collapsed.add(node.id);
                            renderProjectsTree();
                        },
                    } : {},
                }),
                el('span', {
                    class: 'project-tree-row__icon',
                    text: isLegacy ? '📦' : (depth === 0 ? '📁' : '📂'),
                }),
                el('span', {
                    class: 'project-tree-row__name',
                    title: node.name || '',
                    text: node.name || '(untitled)',
                }),
                isLegacy ? el('span', { class: 'project-tree-row__legacy-badge', text: 'Legacy' }) : null,
            ]);

            const nodeWrap = el('div', {
                class: 'project-tree-node',
                dataset: { projectId: String(node.id) },
            }, [row]);

            if (hasChildren) {
                const childWrap = el('div', {
                    class: 'project-tree-children' + (collapsed ? ' collapsed' : ''),
                });
                for (const c of node.children) {
                    const rendered = renderNode(c, depth + 1);
                    if (rendered) childWrap.appendChild(rendered);
                }
                nodeWrap.appendChild(childWrap);
            }
            return nodeWrap;
        };
        for (const root of roots) {
            const n = renderNode(root, 0);
            if (n) container.appendChild(n);
        }
    }

    $pj('projects-search')?.addEventListener('input', () => renderProjectsTree());

    function findProjectInFlat(id) {
        return projectsState.flat.find(p => p.id === id) || null;
    }

    function buildBreadcrumbs(project) {
        const chain = [];
        let cursor = project;
        const guard = new Set();
        while (cursor && !guard.has(cursor.id)) {
            guard.add(cursor.id);
            chain.unshift(cursor);
            cursor = cursor.parent_id ? findProjectInFlat(cursor.parent_id) : null;
        }
        return chain.slice(0, -1);
    }

    async function selectProject(id) {
        projectsState.activeId = id;
        try {
            const res = await fetch(`/api/projects/${id}`);
            if (!res.ok) throw new Error(await res.text());
            projectsState.activeProject = await res.json();
        } catch (e) {
            console.error('selectProject fetch failed', e);
            projectsState.activeProject = findProjectInFlat(id);
        }
        renderProjectsTree();
        renderProjectDetail();
    }

    function renderProjectDetail() {
        const empty = $pj('project-empty-state');
        const detail = $pj('project-detail');
        const proj = projectsState.activeProject;
        if (!proj) {
            if (empty) empty.classList.remove('hidden');
            if (detail) detail.classList.add('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');
        if (detail) detail.classList.remove('hidden');

        $pj('project-name').textContent = proj.name || '(untitled)';
        $pj('project-goal').textContent = proj.goal || 'No goal set. Click ✎ Edit to add one.';
        $pj('project-description').textContent = proj.description || 'No description yet.';

        const crumbs = buildBreadcrumbs(proj);
        const crumbEl = $pj('project-breadcrumbs');
        if (crumbEl) {
            clearChildren(crumbEl);
            crumbs.forEach((c, idx) => {
                if (idx > 0) crumbEl.appendChild(el('span', { class: 'crumb-sep', text: '›' }));
                crumbEl.appendChild(el('span', {
                    class: 'crumb',
                    text: c.name || '',
                    dataset: { projectId: String(c.id) },
                    on: { click: () => selectProject(c.id) },
                }));
            });
        }

        const counts = proj.counts || {};
        $pj('project-meta-client').textContent = 'Client: ' + (proj.client_id ? `#${proj.client_id}` : '—');
        $pj('project-meta-materials').textContent = `Materials: ${counts.materials ?? 0}`;
        $pj('project-meta-runs').textContent = `Runs: ${counts.runs ?? 0}`;
        $pj('project-meta-artifacts').textContent = `Artifacts: ${counts.artifacts ?? 0}`;
        $pj('project-meta-children').textContent = `Sub-projects: ${counts.children ?? 0}`;

        // Phase 5 — cost chip
        const costChip = $pj('project-meta-cost');
        const totalCostCents = proj.total_cost_cents || 0;
        if (costChip) {
            if (totalCostCents > 0) {
                costChip.textContent = `Cost: $${(totalCostCents / 100).toFixed(2)}`;
                costChip.style.display = '';
            } else {
                costChip.textContent = '';
                costChip.style.display = 'none';
            }
        }

        const isLegacy = (proj.metadata || {}).legacy_holder === true;
        const subBtn = $pj('project-new-subproject-btn');
        if (subBtn) subBtn.disabled = isLegacy;

        const childrenListEl = $pj('project-children-list');
        if (childrenListEl) {
            clearChildren(childrenListEl);
            const kids = projectsState.flat.filter(p => p.parent_id === proj.id);
            if (!kids.length) {
                childrenListEl.appendChild(el('p', { class: 'muted-text', text: 'No sub-projects yet.' }));
            } else {
                for (const k of kids) {
                    childrenListEl.appendChild(el('div', {
                        class: 'project-child-card',
                        dataset: { projectId: String(k.id) },
                    }, [
                        el('div', { class: 'project-child-card__main' }, [
                            el('p', { class: 'project-child-card__name', text: '📂 ' + (k.name || '') }),
                            el('div', { class: 'project-child-card__meta', text: k.goal || '' }),
                        ]),
                        el('button', {
                            class: 'secondary-btn btn-sm',
                            text: 'Open →',
                            on: { click: () => selectProject(k.id) },
                        }),
                    ]));
                }
            }
        }

        renderActiveTabContent();
    }

    document.querySelectorAll('.project-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            projectsState.activeTab = tab.dataset.tab;
            document.querySelectorAll('.project-tab-panel').forEach(p => {
                if (p.dataset.panel === projectsState.activeTab) {
                    p.classList.remove('hidden');
                    p.classList.add('active');
                } else {
                    p.classList.add('hidden');
                    p.classList.remove('active');
                }
            });
            renderActiveTabContent();
        });
    });

    async function renderActiveTabContent() {
        const proj = projectsState.activeProject;
        if (!proj) return;
        const tab = projectsState.activeTab;
        if (tab === 'materials') return renderMaterialsTab(proj.id);
        if (tab === 'runs') return renderRunsTab(proj.id);
        if (tab === 'artifacts') return renderArtifactsTab(proj.id);
        if (tab === 'backlog') return renderBacklogTab(proj.id);
        if (tab === 'documents') return renderDocumentsTab(proj.id);
    }

    function formatBytes(n) {
        if (n == null) return '';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    async function renderMaterialsTab(projectId) {
        const listEl = $pj('materials-list');
        if (!listEl) return;
        clearChildren(listEl);
        listEl.appendChild(el('p', { class: 'muted-text', text: 'Loading...' }));
        try {
            const rows = await fetch(`/api/projects/${projectId}/materials`).then(r => r.json());
            clearChildren(listEl);
            if (!Array.isArray(rows) || !rows.length) {
                listEl.appendChild(el('p', { class: 'muted-text', text: 'No materials attached yet.' }));
                return;
            }
            for (const m of rows) {
                const label = m.filename || m.source_url || (m.content_text || '').slice(0, 60) || 'Untitled';
                const meta = m.metadata || {};
                const extractedKind = meta.extracted || m.kind || '';
                const childCount = meta.entry_count ? ` · ${meta.entry_count} entries` : '';
                const pageCount = meta.pages ? ` · ${meta.pages} pages` : '';
                const errorBadge = meta.error
                    ? ' · ⚠ ' + String(meta.error).slice(0, 60)
                    : '';

                const card = el('div', {
                    class: 'material-card',
                    dataset: { id: String(m.id) },
                    on: {
                        click: (e) => {
                            // Don't open preview when clicking the Remove button.
                            if (e.target.dataset.del) return;
                            openMaterialPreview(projectId, m.id);
                        },
                    },
                }, [
                    el('div', { class: 'material-card__main' }, [
                        el('p', { class: 'material-card__name' }, [
                            el('span', { class: 'material-kind-badge', text: m.kind || '' }),
                            ' ' + label,
                            extractedKind ? el('span', {
                                class: 'material-card__extracted kind-' + extractedKind,
                                text: extractedKind,
                            }) : null,
                        ]),
                        el('div', {
                            class: 'material-card__meta',
                            text: (m.size_bytes ? `${formatBytes(m.size_bytes)} · ` : '') +
                                  (m.created_at ? new Date(m.created_at).toLocaleString() : '') +
                                  childCount + pageCount + errorBadge,
                        }),
                    ]),
                    el('button', {
                        class: 'secondary-btn btn-sm',
                        text: 'Remove',
                        dataset: { del: String(m.id) },
                        on: {
                            click: async (e) => {
                                e.stopPropagation();
                                if (!confirm('Remove this material?')) return;
                                await fetch(`/api/projects/${projectId}/materials/${m.id}`, { method: 'DELETE' });
                                renderMaterialsTab(projectId);
                                selectProject(projectId);
                            },
                        },
                    }),
                ]);
                listEl.appendChild(card);
            }
        } catch (e) {
            clearChildren(listEl);
            listEl.appendChild(el('p', { class: 'muted-text', text: 'Could not load materials.' }));
        }
    }

    // ── Drag-drop file upload ───────────────
    function setupMaterialDropzone() {
        const zone = $pj('material-dropzone');
        const input = $pj('material-file-input');
        if (!zone || !input) return;

        zone.addEventListener('click', () => input.click());

        ['dragenter', 'dragover'].forEach(ev =>
            zone.addEventListener(ev, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.add('dragover');
            })
        );
        ['dragleave', 'drop'].forEach(ev =>
            zone.addEventListener(ev, (e) => {
                e.preventDefault();
                e.stopPropagation();
                zone.classList.remove('dragover');
            })
        );

        zone.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) uploadMaterials(files);
        });
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            if (files.length) uploadMaterials(files);
            input.value = '';  // allow re-uploading the same file
        });
    }

    async function uploadMaterials(files) {
        const proj = projectsState.activeProject;
        if (!proj) { alert('Pick a project first.'); return; }
        const statusEl = $pj('material-upload-status');
        if (statusEl) {
            clearChildren(statusEl);
            const summary = el('div', { text: `Uploading ${files.length} file(s)...` });
            statusEl.appendChild(summary);
        }
        const fd = new FormData();
        for (const f of files) fd.append('files', f, f.name);
        try {
            const res = await fetch(`/api/projects/${proj.id}/materials/upload`, {
                method: 'POST',
                body: fd,
            });
            const data = await res.json();
            if (statusEl) {
                clearChildren(statusEl);
                const ok = data.saved_count || 0;
                statusEl.appendChild(el('div', {
                    class: 'upload-row ok',
                    text: `✓ Saved ${ok} file(s)`,
                }));
                for (const e of (data.errors || [])) {
                    statusEl.appendChild(el('div', {
                        class: 'upload-row error',
                        text: `✗ ${e.filename}: ${e.error}`,
                    }));
                }
            }
            renderMaterialsTab(proj.id);
            selectProject(proj.id);
        } catch (e) {
            if (statusEl) {
                clearChildren(statusEl);
                statusEl.appendChild(el('div', { class: 'upload-row error', text: 'Upload failed: ' + e.message }));
            }
        }
    }

    // ── Material preview modal ──────────────
    async function openMaterialPreview(projectId, materialId) {
        const overlay = $pj('material-preview-overlay');
        const titleEl = $pj('material-preview-title');
        const metaEl = $pj('material-preview-meta');
        const bodyEl = $pj('material-preview-body');
        if (!overlay || !bodyEl) return;
        clearChildren(metaEl);
        bodyEl.textContent = 'Loading...';
        overlay.classList.remove('hidden');
        try {
            const data = await fetch(`/api/projects/${projectId}/materials/${materialId}/preview`).then(r => r.json());
            titleEl.textContent = data.filename || '(untitled)';
            const metaParts = [
                data.kind || '',
                data.mime_type || '',
                data.size_bytes ? formatBytes(data.size_bytes) : '',
                'extracted: ' + (data.metadata?.extracted || 'none'),
                'body: ' + (data.content_length || 0) + ' chars',
            ].filter(Boolean);
            metaEl.textContent = metaParts.join(' · ');
            if (data.metadata?.error) {
                metaEl.appendChild(el('div', {
                    style: 'color:#fca5a5; margin-top:4px;',
                    text: '⚠ ' + data.metadata.error,
                }));
            }
            bodyEl.textContent = data.content_text || '(no extracted text — binary or empty)';
        } catch (e) {
            bodyEl.textContent = 'Could not load preview: ' + e.message;
        }
    }

    function closeMaterialPreview() {
        const overlay = $pj('material-preview-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    $pj('material-preview-close')?.addEventListener('click', closeMaterialPreview);
    $pj('material-preview-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'material-preview-overlay') closeMaterialPreview();
    });

    setupMaterialDropzone();

    $pj('add-material-btn')?.addEventListener('click', async () => {
        const proj = projectsState.activeProject;
        if (!proj) return;
        const kind = $pj('material-kind').value;
        const title = $pj('material-title').value.trim();
        const body = $pj('material-body').value.trim();
        if (!body) { alert('Paste something to attach.'); return; }
        const payload = { project_id: proj.id, kind };
        if (kind === 'url') {
            payload.source_url = body;
            payload.filename = title || body;
        } else {
            payload.content_text = body;
            payload.filename = title || 'Pasted text';
            payload.size_bytes = body.length;
        }
        const res = await fetch(`/api/projects/${proj.id}/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) { alert('Could not save material.'); return; }
        $pj('material-body').value = '';
        $pj('material-title').value = '';
        renderMaterialsTab(proj.id);
        selectProject(proj.id);
    });

    async function renderRunsTab(projectId) {
        const listEl = $pj('runs-list');
        if (!listEl) return;
        clearChildren(listEl);
        listEl.appendChild(el('p', { class: 'muted-text', text: 'Loading...' }));
        try {
            const rows = await fetch(`/api/projects/${projectId}/runs`).then(r => r.json());
            clearChildren(listEl);
            if (!Array.isArray(rows) || !rows.length) {
                listEl.appendChild(el('p', {
                    class: 'muted-text',
                    text: 'No runs yet. Kick off the agent fleet using ▶ Run agent fleet.',
                }));
                return;
            }
            for (const r of rows) {
                const parts = [
                    el('span', { class: 'run-kind-badge', text: r.kind || '' }),
                    ' ',
                    el('span', { class: 'run-status-badge status-' + (r.status || ''), text: r.status || '' }),
                ];
                if (r.error) {
                    parts.push(' ', el('span', {
                        style: 'color:#fca5a5;',
                        text: '· ' + String(r.error).slice(0, 80),
                    }));
                }
                const started = r.started_at ? new Date(r.started_at).toLocaleString() : '';
                const finished = r.finished_at ? ' · Finished ' + new Date(r.finished_at).toLocaleString() : '';
                const cost = r.token_cost_cents ? ' · $' + (r.token_cost_cents / 100).toFixed(2) : '';
                listEl.appendChild(el('div', { class: 'run-card' }, [
                    el('div', { class: 'run-card__main' }, [
                        el('p', {}, parts),
                        el('div', { class: 'run-card__meta', text: 'Started ' + started + finished + cost }),
                    ]),
                ]));
            }
        } catch (e) {
            clearChildren(listEl);
            listEl.appendChild(el('p', { class: 'muted-text', text: 'Could not load runs.' }));
        }
    }

    async function renderArtifactsTab(projectId) {
        const listEl = $pj('artifacts-list');
        if (!listEl) return;
        clearChildren(listEl);
        listEl.appendChild(el('p', { class: 'muted-text', text: 'Loading...' }));
        try {
            const rows = await fetch(`/api/projects/${projectId}/artifacts`).then(r => r.json());
            clearChildren(listEl);
            if (!Array.isArray(rows) || !rows.length) {
                listEl.appendChild(el('p', { class: 'muted-text', text: 'No artifacts yet.' }));
                return;
            }
            for (const a of rows) {
                listEl.appendChild(el('div', { class: 'artifact-card' }, [
                    el('div', { class: 'artifact-card__main' }, [
                        el('p', { class: 'artifact-card__title' }, [
                            el('span', {
                                class: 'artifact-kind-badge kind-' + (a.kind || ''),
                                text: a.kind || '',
                            }),
                            ' ' + (a.title || a.persona_key || 'Untitled'),
                        ]),
                        el('div', {
                            class: 'artifact-card__meta',
                            text: (a.persona_key ? a.persona_key + ' · ' : '') +
                                  (a.created_at ? new Date(a.created_at).toLocaleString() : ''),
                        }),
                    ]),
                ]));
            }
        } catch (e) {
            clearChildren(listEl);
            listEl.appendChild(el('p', { class: 'muted-text', text: 'Could not load artifacts.' }));
        }
    }

    async function populateClientsDropdown() {
        const select = $pj('project-form-client');
        if (!select) return;
        try {
            const clients = await fetch('/api/clients').then(r => r.json());
            clearChildren(select);
            select.appendChild(el('option', { value: '', text: '-- Unassigned --' }));
            for (const c of (clients || [])) {
                select.appendChild(el('option', { value: String(c.id), text: c.name || '' }));
            }
        } catch (e) { /* non-fatal */ }
    }

    function openProjectModal({ mode, project = null, parentId = null }) {
        projectsState.modalMode = mode;
        projectsState.modalParentId = parentId;

        $pj('project-modal-title').textContent =
            mode === 'edit' ? 'Edit Project' : (parentId ? 'New Sub-project' : 'New Project');

        $pj('project-form-name').value = project?.name || '';
        $pj('project-form-goal').value = project?.goal || '';
        $pj('project-form-description').value = project?.description || '';
        $pj('project-form-client').value = project?.client_id || '';

        const parentGroup = document.querySelector('.project-form-parent-group');
        const inheritGroup = document.querySelector('.project-form-inherit-group');
        if (parentId) {
            const parent = findProjectInFlat(parentId);
            $pj('project-form-parent').value = parent?.name || `#${parentId}`;
            parentGroup?.classList.remove('hidden');
            inheritGroup?.classList.remove('hidden');
            $pj('project-form-inherits').checked =
                project ? (project.inherits_materials !== false) : true;
        } else {
            parentGroup?.classList.add('hidden');
            inheritGroup?.classList.add('hidden');
        }

        populateClientsDropdown().then(() => {
            if (project?.client_id) $pj('project-form-client').value = project.client_id;
        });

        $pj('project-modal-overlay').classList.remove('hidden');
        setTimeout(() => $pj('project-form-name').focus(), 60);
    }

    function closeProjectModal() {
        $pj('project-modal-overlay').classList.add('hidden');
    }

    $pj('project-modal-close')?.addEventListener('click', closeProjectModal);
    $pj('project-form-cancel')?.addEventListener('click', closeProjectModal);
    $pj('project-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'project-modal-overlay') closeProjectModal();
    });

    $pj('new-project-btn')?.addEventListener('click', () => openProjectModal({ mode: 'create' }));
    $pj('new-project-btn-alt')?.addEventListener('click', () => openProjectModal({ mode: 'create' }));
    $pj('project-new-subproject-btn')?.addEventListener('click', () => {
        if (!projectsState.activeProject) return;
        openProjectModal({ mode: 'create', parentId: projectsState.activeProject.id });
    });
    $pj('project-edit-btn')?.addEventListener('click', () => {
        if (!projectsState.activeProject) return;
        openProjectModal({
            mode: 'edit',
            project: projectsState.activeProject,
            parentId: projectsState.activeProject.parent_id || null,
        });
    });

    $pj('project-form-save')?.addEventListener('click', async () => {
        const name = $pj('project-form-name').value.trim();
        if (!name) { alert('Project name is required.'); return; }
        const payload = {
            name,
            goal: $pj('project-form-goal').value.trim() || null,
            description: $pj('project-form-description').value.trim() || null,
            client_id: Number($pj('project-form-client').value) || null,
        };
        if (projectsState.modalParentId) {
            payload.parent_id = projectsState.modalParentId;
            payload.inherits_materials = $pj('project-form-inherits').checked;
        }
        try {
            let res;
            if (projectsState.modalMode === 'edit' && projectsState.activeProject) {
                res = await fetch(`/api/projects/${projectsState.activeProject.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                res = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert('Could not save project: ' + (err.detail || res.statusText));
                return;
            }
            const saved = await res.json();
            closeProjectModal();
            await fetchProjectsTree();
            selectProject(saved.id);
        } catch (e) {
            alert('Network error saving project.');
        }
    });

    $pj('project-run-btn')?.addEventListener('click', () => {
        if (!projectsState.activeProject) return;
        state.selectedProjectId = projectsState.activeProject.id;
        state.selectedProjectName = projectsState.activeProject.name;
        const ingestionBtn = document.querySelector('.nav-btn[data-target="ingestion"]');
        if (ingestionBtn) ingestionBtn.click();
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === 'projects') {
            btn.addEventListener('click', fetchProjectsTree);
        }
    });

    fetchProjectsTree();

    /* ============================================================
       Phase 4 — Interactive Backlog (per-project Kanban)
       Reads from / writes to the REST endpoints under
       /api/projects/{id}/backlog. Items are stored server-side as
       project_artifacts with kind='backlog_item'.
       ============================================================ */

    const BACKLOG_COLUMNS = [
        { status: 'backlog',     label: 'Backlog' },
        { status: 'todo',        label: 'To Do' },
        { status: 'in_progress', label: 'In Progress' },
        { status: 'done',        label: 'Done' },
    ];

    const BACKLOG_PRIORITIES = ['high', 'med', 'low'];
    const BACKLOG_STATUSES   = BACKLOG_COLUMNS.map(c => c.status);

    const backlogState = {
        projectId: null,
        items: [],
        loading: false,
        editing: null,        // currently-edited item (or null for "new")
        dragId: null,         // id being dragged
    };

    function backlogStatus(text, kind) {
        const node = $pj('backlog-status');
        if (!node) return;
        node.textContent = text || '';
        node.classList.remove('is-error', 'is-success', 'is-busy');
        if (kind) node.classList.add('is-' + kind);
    }

    function backlogCounts(items) {
        const counts = { total: items.length };
        for (const s of BACKLOG_STATUSES) counts[s] = 0;
        for (const it of items) {
            const s = (it.structured_data && it.structured_data.status) || 'backlog';
            if (counts[s] != null) counts[s] += 1;
        }
        const node = $pj('backlog-counts');
        if (node) {
            node.textContent = `${counts.total} item${counts.total === 1 ? '' : 's'}` +
                ` · ${counts.in_progress} in progress · ${counts.done} done`;
        }
        return counts;
    }

    function backlogItemView(item) {
        // Normalise an artifact row from the API into a flat view-model.
        const sd = item.structured_data || {};
        return {
            id: item.id,
            title: item.title || sd.title || '(untitled)',
            story: sd.story || '',
            acceptance_criteria: Array.isArray(sd.acceptance_criteria) ? sd.acceptance_criteria : [],
            points: Number.isFinite(sd.points) ? sd.points : (sd.points ? Number(sd.points) : 0),
            priority: sd.priority || 'med',
            status: sd.status || 'backlog',
            source: sd.source || 'manual',
            epic: sd.epic || '',
            raw: item,
        };
    }

    async function renderBacklogTab(projectId) {
        backlogState.projectId = projectId;
        const board = $pj('backlog-board');
        if (!board) return;

        // Skeleton — render 4 empty columns immediately so UI feels responsive.
        renderBacklog([]);
        backlogStatus('Loading…', 'busy');

        try {
            const res = await fetch(`/api/projects/${projectId}/backlog`);
            if (!res.ok) throw new Error(await res.text());
            const items = await res.json();
            backlogState.items = Array.isArray(items) ? items : [];
            renderBacklog(backlogState.items);
            backlogStatus('');
        } catch (e) {
            console.error('backlog fetch failed', e);
            backlogStatus('Could not load backlog: ' + (e.message || e), 'error');
        }
    }

    function renderBacklog(items) {
        const board = $pj('backlog-board');
        if (!board) return;
        clearChildren(board);

        const views = items.map(backlogItemView);
        const byStatus = {};
        for (const s of BACKLOG_STATUSES) byStatus[s] = [];
        for (const v of views) {
            const bucket = byStatus[v.status] ? v.status : 'backlog';
            byStatus[bucket].push(v);
        }
        backlogCounts(items);

        for (const col of BACKLOG_COLUMNS) {
            board.appendChild(renderBacklogColumn(col, byStatus[col.status] || []));
        }
    }

    function renderBacklogColumn(col, items) {
        const colNode = el('div', {
            class: 'backlog-col',
            dataset: { status: col.status },
            on: {
                dragover: (e) => {
                    if (backlogState.dragId == null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    colNode.classList.add('is-drop-target');
                },
                dragleave: () => colNode.classList.remove('is-drop-target'),
                drop: async (e) => {
                    e.preventDefault();
                    colNode.classList.remove('is-drop-target');
                    const id = backlogState.dragId;
                    backlogState.dragId = null;
                    if (id == null) return;
                    await moveBacklogItem(id, col.status);
                },
            },
        }, [
            el('div', { class: 'backlog-col__header' }, [
                el('span', { text: col.label }),
                el('span', { class: 'backlog-col__count', text: String(items.length) }),
            ]),
        ]);

        const body = el('div', { class: 'backlog-col__body' });
        if (!items.length) {
            body.appendChild(el('div', { class: 'backlog-empty', text: 'Drop stories here' }));
        } else {
            for (const it of items) body.appendChild(renderBacklogItem(it));
        }
        colNode.appendChild(body);
        return colNode;
    }

    function renderBacklogItem(view) {
        const priority = BACKLOG_PRIORITIES.includes(view.priority) ? view.priority : 'med';
        const points = view.points && view.points > 0 ? view.points : null;
        const card = el('div', {
            class: 'backlog-item',
            draggable: true,
            dataset: { id: String(view.id), status: view.status },
            on: {
                click: () => openBacklogEditor(view),
                dragstart: (e) => {
                    backlogState.dragId = view.id;
                    card.classList.add('is-dragging');
                    try { e.dataTransfer.setData('text/plain', String(view.id)); } catch (_) {}
                    e.dataTransfer.effectAllowed = 'move';
                },
                dragend: () => {
                    card.classList.remove('is-dragging');
                    document.querySelectorAll('.backlog-col.is-drop-target')
                        .forEach(n => n.classList.remove('is-drop-target'));
                },
            },
        }, [
            el('div', { class: 'backlog-item__top' }, [
                el('span', {
                    class: `backlog-item__priority priority-${priority}`,
                    text: priority.toUpperCase(),
                }),
                points != null ? el('span', { class: 'backlog-item__points', text: String(points) }) : null,
            ].filter(Boolean)),
            el('h4', { class: 'backlog-item__title', text: view.title }),
            view.story ? el('p', { class: 'backlog-item__story', text: view.story }) : null,
            el('div', { class: 'backlog-item__footer' }, [
                el('span', {
                    class: `backlog-item__source source-${view.source}`,
                    text: view.source === 'ba_agent' ? 'BA agent' : view.source,
                }),
                el('span', {
                    class: 'backlog-item__epic',
                    text: view.epic || '',
                    title: view.epic || '',
                }),
            ]),
        ].filter(Boolean));
        return card;
    }

    async function moveBacklogItem(itemId, newStatus) {
        if (!BACKLOG_STATUSES.includes(newStatus)) return;
        const projectId = backlogState.projectId;
        const local = backlogState.items.find(i => i.id === itemId);
        // Same-column drop is a no-op — skip the round-trip.
        if (local && (local.structured_data || {}).status === newStatus) return;
        // Optimistic local update — keeps the UI snappy.
        if (local) {
            local.structured_data = local.structured_data || {};
            local.structured_data.status = newStatus;
            renderBacklog(backlogState.items);
        }
        try {
            const res = await fetch(`/api/projects/${projectId}/backlog/${itemId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            if (!res.ok) throw new Error(await res.text());
            const updated = await res.json();
            // Refresh that single item's structured_data from authoritative response.
            if (local && updated && updated.structured_data) {
                local.structured_data = updated.structured_data;
                renderBacklog(backlogState.items);
            }
            backlogStatus('Moved to ' + newStatus.replace('_', ' '), 'success');
            setTimeout(() => backlogStatus(''), 1600);
        } catch (e) {
            console.error('moveBacklogItem failed', e);
            backlogStatus('Move failed — reloading.', 'error');
            renderBacklogTab(projectId);
        }
    }

    /* ----- Edit / create modal ----- */

    function openBacklogEditor(view) {
        backlogState.editing = view; // null = new
        const overlay = $pj('backlog-edit-overlay');
        const heading = $pj('backlog-edit-title');
        const titleI  = $pj('backlog-edit-title-input');
        const storyI  = $pj('backlog-edit-story-input');
        const acI     = $pj('backlog-edit-ac-input');
        const ptsI    = $pj('backlog-edit-points-input');
        const prioI   = $pj('backlog-edit-priority-input');
        const statI   = $pj('backlog-edit-status-input');
        const epicI   = $pj('backlog-edit-epic-input');
        const delBtn  = $pj('backlog-edit-delete');

        if (view) {
            heading.textContent = 'Edit story';
            titleI.value = view.title || '';
            storyI.value = view.story || '';
            acI.value    = (view.acceptance_criteria || []).join('\n');
            ptsI.value   = view.points || 0;
            prioI.value  = BACKLOG_PRIORITIES.includes(view.priority) ? view.priority : 'med';
            statI.value  = BACKLOG_STATUSES.includes(view.status) ? view.status : 'backlog';
            epicI.value  = view.epic || '';
            if (delBtn) delBtn.classList.remove('hidden');
        } else {
            heading.textContent = 'New story';
            titleI.value = '';
            storyI.value = '';
            acI.value    = '';
            ptsI.value   = 3;
            prioI.value  = 'med';
            statI.value  = 'backlog';
            epicI.value  = '';
            if (delBtn) delBtn.classList.add('hidden');
        }
        overlay.classList.remove('hidden');
        // Defer focus so the overlay paint finishes first.
        setTimeout(() => titleI && titleI.focus(), 50);
    }

    function closeBacklogEditor() {
        const overlay = $pj('backlog-edit-overlay');
        if (overlay) overlay.classList.add('hidden');
        backlogState.editing = null;
    }

    function readBacklogEditor() {
        const ac = ($pj('backlog-edit-ac-input').value || '')
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);
        const ptsRaw = parseInt($pj('backlog-edit-points-input').value, 10);
        return {
            title:    ($pj('backlog-edit-title-input').value || '').trim(),
            story:    ($pj('backlog-edit-story-input').value || '').trim(),
            acceptance_criteria: ac,
            points:   Number.isFinite(ptsRaw) ? ptsRaw : 0,
            priority: $pj('backlog-edit-priority-input').value || 'med',
            status:   $pj('backlog-edit-status-input').value || 'backlog',
            epic:     ($pj('backlog-edit-epic-input').value || '').trim(),
        };
    }

    async function saveBacklogItemFromEditor() {
        const projectId = backlogState.projectId;
        if (!projectId) return;
        const payload = readBacklogEditor();
        if (!payload.title) {
            backlogStatus('Title is required.', 'error');
            return;
        }
        const editing = backlogState.editing;
        try {
            backlogStatus(editing ? 'Saving…' : 'Creating…', 'busy');
            let res;
            if (editing) {
                res = await fetch(`/api/projects/${projectId}/backlog/${editing.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                payload.source = 'manual';
                res = await fetch(`/api/projects/${projectId}/backlog`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }
            if (!res.ok) throw new Error(await res.text());
            closeBacklogEditor();
            backlogStatus(editing ? 'Saved.' : 'Created.', 'success');
            await renderBacklogTab(projectId);
            setTimeout(() => backlogStatus(''), 1600);
        } catch (e) {
            console.error('saveBacklogItemFromEditor failed', e);
            backlogStatus('Save failed: ' + (e.message || e), 'error');
        }
    }

    async function deleteBacklogItemFromEditor() {
        const editing = backlogState.editing;
        const projectId = backlogState.projectId;
        if (!editing || !projectId) return;
        if (!confirm(`Delete "${editing.title}"? This cannot be undone from the UI.`)) return;
        try {
            backlogStatus('Deleting…', 'busy');
            const res = await fetch(`/api/projects/${projectId}/backlog/${editing.id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error(await res.text());
            closeBacklogEditor();
            backlogStatus('Deleted.', 'success');
            await renderBacklogTab(projectId);
            setTimeout(() => backlogStatus(''), 1600);
        } catch (e) {
            console.error('deleteBacklogItemFromEditor failed', e);
            backlogStatus('Delete failed: ' + (e.message || e), 'error');
        }
    }

    async function importBacklogFromBA() {
        const projectId = backlogState.projectId;
        if (!projectId) return;
        try {
            backlogStatus('Importing latest BA stories…', 'busy');
            const res = await fetch(`/api/projects/${projectId}/backlog/import-from-ba`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),  // server falls back to most recent stored BA artifact
            });
            if (!res.ok) throw new Error(await res.text());
            const summary = await res.json();
            await renderBacklogTab(projectId);
            const msg = `Imported ${summary.imported || 0} new (${summary.skipped_existing || 0} duplicate).`;
            backlogStatus(msg, summary.imported ? 'success' : null);
            setTimeout(() => backlogStatus(''), 2400);
        } catch (e) {
            console.error('importBacklogFromBA failed', e);
            backlogStatus('Import failed: ' + (e.message || e), 'error');
        }
    }

    /* ----- Toolbar + modal wiring (one-time, on DOM ready) ----- */

    $pj('backlog-new-btn')?.addEventListener('click', () => {
        if (!backlogState.projectId) return;
        openBacklogEditor(null);
    });

    $pj('backlog-import-ba-btn')?.addEventListener('click', () => {
        if (!backlogState.projectId) return;
        importBacklogFromBA();
    });

    $pj('backlog-refresh-btn')?.addEventListener('click', () => {
        if (!backlogState.projectId) return;
        renderBacklogTab(backlogState.projectId);
    });

    $pj('backlog-edit-close')?.addEventListener('click', closeBacklogEditor);
    $pj('backlog-edit-cancel')?.addEventListener('click', closeBacklogEditor);
    $pj('backlog-edit-save')?.addEventListener('click', saveBacklogItemFromEditor);
    $pj('backlog-edit-delete')?.addEventListener('click', deleteBacklogItemFromEditor);

    // Click outside the modal to close.
    $pj('backlog-edit-overlay')?.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'backlog-edit-overlay') closeBacklogEditor();
    });

    // Escape closes the editor.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = $pj('backlog-edit-overlay');
            if (overlay && !overlay.classList.contains('hidden')) closeBacklogEditor();
        }
    });

    // ═══════════════════════════════════════════════
    // Phase 7 — Project Documents (Living Knowledge)
    // ═══════════════════════════════════════════════

    const DOC_META = {
        doc_run_summary:     { icon: '📄', label: 'Run Summary',           color: '#60a5fa' },
        doc_lessons_learned: { icon: '💡', label: 'Lessons Learned',       color: '#fbbf24' },
        doc_decision_log:    { icon: '📐', label: 'Decision Log',          color: '#a78bfa' },
        doc_risk_register:   { icon: '⚠️', label: 'Risk Register',        color: '#f87171' },
        doc_tech_debt:       { icon: '🔧', label: 'Technical Debt',        color: '#fb923c' },
        doc_agent_notes:     { icon: '🤖', label: 'Agent Knowledge Notes', color: '#34d399' },
    };

    async function renderDocumentsTab(projectId) {
        const container = document.getElementById('project-docs-list');
        if (!container) return;
        container.innerHTML = '<p class="muted-text">Loading documents...</p>';

        try {
            const res = await fetch(`/api/projects/${projectId}/documents`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const docs = await res.json();

            if (!docs.length) {
                container.innerHTML = '<p class="muted-text">No documents yet. Run an analysis to generate project documentation.</p>';
                return;
            }

            container.innerHTML = docs.map(doc => {
                const meta = DOC_META[doc.doc_kind] || { icon: '📄', label: doc.doc_kind, color: '#888' };
                const updated = doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : '';
                return `
                    <details class="project-doc-card" style="border-left: 3px solid ${meta.color};">
                        <summary class="project-doc-card__header">
                            <span class="project-doc-card__icon">${meta.icon}</span>
                            <span class="project-doc-card__title">${meta.label}</span>
                            ${updated ? `<span class="project-doc-card__date">Updated: ${updated}</span>` : ''}
                        </summary>
                        <div class="project-doc-card__body">${simpleMarkdown(doc.content || '(empty)')}</div>
                    </details>`;
            }).join('');
        } catch (e) {
            container.innerHTML = `<p class="muted-text">Failed to load documents: ${e.message}</p>`;
        }
    }

    // Wire up the refresh button
    document.getElementById('docs-refresh-btn')?.addEventListener('click', () => {
        const proj = projectsState?.activeProject;
        if (proj) renderDocumentsTab(proj.id);
    });


    // ═══════════════════════════════════════════════
    // Phase 6 — Agent Confidence Panel
    // ═══════════════════════════════════════════════

    /**
     * Render the confidence report grid showing each agent's self-assessment.
     * Called when `confidence_report` SSE event arrives.
     */
    function renderConfidenceReport(data) {
        const panel = document.getElementById('confidence-panel');
        const grid = document.getElementById('confidence-grid');
        const summaryText = document.getElementById('confidence-summary-text');
        if (!panel || !grid) return;

        // Store session id if present
        if (data.fleet_session_id) _fleetSessionId = data.fleet_session_id;

        const probes = data.probes || {};
        const keys = Object.keys(probes);
        const highCount = keys.filter(k => probes[k].confidence === 'high').length;
        const medCount = keys.filter(k => probes[k].confidence === 'medium').length;
        const lowCount = keys.filter(k => probes[k].confidence === 'low').length;

        if (summaryText) {
            summaryText.textContent = `${keys.length} agents probed — ` +
                `${highCount} high confidence, ${medCount} medium, ${lowCount} low` +
                (data.cross_agent_briefing_available ? ' • High-confidence agents will brief the others' : '');
        }

        // Sort: low first (they need attention), then medium, then high
        const order = { low: 0, medium: 1, high: 2 };
        const sorted = keys.sort((a, b) => (order[probes[a].confidence] || 1) - (order[probes[b].confidence] || 1));

        grid.innerHTML = sorted.map(key => {
            const p = probes[key];
            const level = p.confidence || 'medium';
            const gapsHtml = (p.gaps || []).length
                ? `<ul class="cc-gaps">${p.gaps.slice(0, 3).map(g => `<li>${escapeHTML(g)}</li>`).join('')}</ul>`
                : '';
            return `
                <div class="confidence-card">
                    <span class="cc-emoji">${p.emoji || '🤖'}</span>
                    <div class="cc-body">
                        <div class="cc-name">${escapeHTML(p.name || key)}</div>
                        <span class="cc-level cc-level--${level}">${level}</span>
                        ${gapsHtml}
                    </div>
                </div>`;
        }).join('');

        panel.classList.remove('hidden');
        updateFleetStatusMessage(`Confidence check complete — ${lowCount ? lowCount + ' agent(s) need help' : 'all agents ready'}`);
    }

    /**
     * Show the Q&A section with questions from agents that need user input.
     * Called when `awaiting_answers` SSE event arrives.
     */
    function showConfidenceQA(data) {
        const qaSection = document.getElementById('confidence-qa');
        const questionsList = document.getElementById('confidence-questions-list');
        if (!qaSection || !questionsList) return;

        if (data.fleet_session_id) _fleetSessionId = data.fleet_session_id;

        const questions = data.questions || {};
        const agentKeys = Object.keys(questions);
        if (!agentKeys.length) return;

        questionsList.innerHTML = agentKeys.map(key => {
            const qs = questions[key];
            const config = state.personaConfigs[key] || {};
            const name = config.name || key;
            const emoji = config.emoji || '🤖';

            const qRows = qs.map((q, i) => `
                <div class="cq-question-row">
                    <label>${escapeHTML(q)}</label>
                    <input type="text" data-agent="${key}" data-qi="${i}"
                        placeholder="Your answer (leave blank to skip)">
                </div>`).join('');

            return `
                <div class="cq-agent-block">
                    <div class="cq-agent-block__header">
                        <span>${emoji}</span> ${escapeHTML(name)}
                    </div>
                    <div class="cq-agent-block__questions">${qRows}</div>
                </div>`;
        }).join('');

        qaSection.classList.remove('hidden');
        updateFleetStatusMessage(`${agentKeys.length} agent(s) have questions — answer below or skip to proceed`);
    }

    /** Collect answers from the Q&A form and POST them */
    async function submitConfidenceAnswers() {
        if (!_fleetSessionId) return;

        const answers = {};
        document.querySelectorAll('#confidence-questions-list input[data-agent]').forEach(input => {
            const val = input.value.trim();
            if (!val) return;
            const agentKey = input.getAttribute('data-agent');
            if (!answers[agentKey]) answers[agentKey] = [];
            answers[agentKey].push(val);
        });

        const globalAnswer = (document.getElementById('confidence-global-answer')?.value || '').trim();
        const extraUrlsRaw = (document.getElementById('confidence-extra-urls')?.value || '').trim();
        const extraUrls = extraUrlsRaw ? extraUrlsRaw.split('\n').map(u => u.trim()).filter(Boolean) : [];

        try {
            document.getElementById('confidence-submit-btn').disabled = true;
            document.getElementById('confidence-skip-btn').disabled = true;
            updateFleetStatusMessage('Submitting answers — agents will resume shortly...');

            await fetch(`/api/fleet-answer/${_fleetSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answers,
                    global_answer: globalAnswer,
                    extra_urls: extraUrls,
                }),
            });

            // Hide the Q&A panel after submission
            const qaSection = document.getElementById('confidence-qa');
            if (qaSection) qaSection.classList.add('hidden');
            updateFleetStatusMessage('Answers received — launching fleet...');
        } catch (e) {
            console.error('Failed to submit confidence answers', e);
            updateFleetStatusMessage('Error submitting answers — fleet will proceed after timeout');
        }
    }

    /** Skip the Q&A and let agents proceed immediately */
    async function skipConfidenceQA() {
        if (!_fleetSessionId) return;
        try {
            document.getElementById('confidence-submit-btn').disabled = true;
            document.getElementById('confidence-skip-btn').disabled = true;
            updateFleetStatusMessage('Skipping Q&A — launching fleet...');

            await fetch(`/api/fleet-skip/${_fleetSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            const qaSection = document.getElementById('confidence-qa');
            if (qaSection) qaSection.classList.add('hidden');
        } catch (e) {
            console.error('Failed to skip confidence Q&A', e);
        }
    }

    /** Simple HTML escaper for confidence panel text */
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Wire up confidence panel buttons
    document.getElementById('confidence-submit-btn')?.addEventListener('click', submitConfidenceAnswers);
    document.getElementById('confidence-skip-btn')?.addEventListener('click', skipConfidenceQA);


    // ═══════════════════════════════════════════════
    // Phase 7B — Specialist Agent Proposals
    // ═══════════════════════════════════════════════

    // ═══════════════════════════════════════════════
    // Phase 9 — Cross-Domain Flags renderer
    // Surfaced as a transient panel between fleet completion and synthesis,
    // showing what each agent flagged for whom. Synthesis is told to resolve
    // each flag explicitly — this panel is the user-facing receipt.
    // ═══════════════════════════════════════════════

    function renderCrossDomainFlags(data) {
        const flags = (data && data.flags) || [];
        if (!flags.length) {
            const existing = document.getElementById('cross-domain-flags-panel');
            if (existing) existing.style.display = 'none';
            return;
        }

        // Lazy-create the panel — it didn't exist in initial HTML.
        let panel = document.getElementById('cross-domain-flags-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'cross-domain-flags-panel';
            panel.className = 'cross-domain-flags-panel glass-card fade-in';
            // Insert before the synthesis card so users see flags as they appear,
            // then watch synthesis resolve them.
            const dashboard = document.getElementById('dashboard') || document.querySelector('.dashboard') || document.body;
            const synthCard = document.getElementById('report-synthesis');
            if (synthCard && synthCard.parentNode === dashboard) {
                dashboard.insertBefore(panel, synthCard);
            } else {
                dashboard.appendChild(panel);
            }
        }
        panel.style.display = 'block';

        // Group by target agent for cleaner display.
        const byTarget = {};
        flags.forEach(f => {
            const key = f.target_key || (f.target_raw || 'UNKNOWN').toLowerCase();
            (byTarget[key] = byTarget[key] || []).push(f);
        });

        const groups = Object.entries(byTarget).map(([target, items]) => {
            const targetName = (state.personaConfigs[target] && state.personaConfigs[target].name)
                || target.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const targetEmoji = (state.personaConfigs[target] && state.personaConfigs[target].emoji) || '🎯';
            const items_html = items.map(f => {
                const fromName = (state.personaConfigs[f.from_agent] && state.personaConfigs[f.from_agent].name)
                    || f.from_agent;
                const fromEmoji = (state.personaConfigs[f.from_agent] && state.personaConfigs[f.from_agent].emoji) || '👤';
                // Phase 9 closed-loop: synthesis may have ruled on this flag.
                const resolved = !!f.resolved;
                const ruling = (f.ruling || '').trim();
                const owner = (f.owner || '').trim();
                const ruling_html = resolved && ruling ? `
                    <div class="cdf-resolution">
                        <div class="cdf-resolution-badge">✓ RESOLVED</div>
                        <div class="cdf-resolution-body">
                            <div class="cdf-ruling"><strong>Ruling:</strong> ${escapeHTML(ruling)}</div>
                            ${owner ? `<div class="cdf-owner"><strong>Owner:</strong> ${escapeHTML(owner)}</div>` : ''}
                        </div>
                    </div>
                ` : (f.hasOwnProperty('resolved') ? `
                    <div class="cdf-resolution cdf-resolution--unresolved">
                        <div class="cdf-resolution-badge">⚠ UNRESOLVED</div>
                        <div class="cdf-resolution-body cdf-resolution-hint">
                            Synthesis did not explicitly address this flag — check the verdict's
                            Cross-Domain Flag Resolutions section.
                        </div>
                    </div>
                ` : '');
                return `
                    <li class="cdf-item ${resolved ? 'cdf-item--resolved' : ''}">
                        <div class="cdf-from">${fromEmoji} <strong>${escapeHTML(fromName)}</strong> →</div>
                        <div class="cdf-message">
                            ${escapeHTML(f.message)}
                            ${ruling_html}
                        </div>
                    </li>
                `;
            }).join('');
            return `
                <div class="cdf-group">
                    <div class="cdf-target-header">
                        <span class="cdf-target-emoji">${targetEmoji}</span>
                        <strong>Flagged for ${escapeHTML(targetName)}</strong>
                        <span class="cdf-count">${items.length}</span>
                    </div>
                    <ul class="cdf-list">${items_html}</ul>
                </div>
            `;
        }).join('');

        const resolvedCount = flags.filter(f => f.resolved).length;
        const hasResolutions = flags.some(f => f.hasOwnProperty('resolved'));
        const headerStat = hasResolutions
            ? `<span class="cdf-total cdf-total--resolved">${resolvedCount} of ${flags.length} resolved</span>`
            : `<span class="cdf-total">${flags.length} flag(s) raised between agents</span>`;
        const intro = hasResolutions
            ? `Synthesis ruled on ${resolvedCount} of ${flags.length} cross-domain flag(s) below. Each ruling assigns ownership and a path forward — review the verdict for full context.`
            : `Specialists flagged findings that critically affect other domains. Synthesis will explicitly resolve each one — see the verdict's <em>Cross-Domain Flag Resolutions</em> section.`;
        panel.innerHTML = `
            <div class="cdf-panel-header">
                <span class="cdf-icon">🔥</span>
                <h3>Cross-Domain Flags</h3>
                ${headerStat}
            </div>
            <p class="cdf-intro">${intro}</p>
            <div class="cdf-groups">${groups}</div>
        `;
    }

    let _pendingProposals = [];

    function renderSpecialistProposals(data) {
        const panel = document.getElementById('specialist-panel');
        const list = document.getElementById('specialist-proposals-list');
        const summary = document.getElementById('specialist-summary-text');
        if (!panel || !list) return;

        const proposals = data.proposals || [];
        if (!proposals.length) return;

        _pendingProposals = proposals;

        if (summary) {
            summary.textContent = data.message || `${proposals.length} specialist(s) proposed`;
        }

        list.innerHTML = proposals.map((p, i) => `
            <label class="specialist-proposal-card">
                <input type="checkbox" data-idx="${i}" checked class="specialist-checkbox">
                <span class="specialist-emoji">${p.emoji || '🔬'}</span>
                <div class="specialist-info">
                    <div class="specialist-name">${escapeHTML(p.name || p.persona_key)}</div>
                    <div class="specialist-reason">${escapeHTML(p.reason || '')}</div>
                    <div class="specialist-areas">
                        ${(p.investigation_areas || []).map(a => `<span class="specialist-area-tag">${escapeHTML(a)}</span>`).join('')}
                    </div>
                </div>
            </label>
        `).join('');

        panel.classList.remove('hidden');
    }

    async function approveSpecialists() {
        const checkboxes = document.querySelectorAll('.specialist-checkbox:checked');
        const approvedIdxs = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
        const approved = approvedIdxs.map(i => _pendingProposals[i]).filter(Boolean);
        const approvedKeys = approved.map(p => p.persona_key);

        if (!approved.length) {
            document.getElementById('specialist-panel')?.classList.add('hidden');
            return;
        }

        const proj = projectsState?.activeProject;
        const projectId = proj?.id;
        if (!projectId) {
            alert('No active project — cannot create specialists.');
            return;
        }

        const btn = document.getElementById('specialist-approve-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Creating specialists...'; }

        try {
            const res = await fetch('/api/approve-specialists-v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposals: approved,
                    approved_keys: approvedKeys,
                    project_id: projectId,
                }),
            });
            const result = await res.json();
            const created = (result.created || []).filter(c => c.status === 'created');

            if (created.length) {
                updateFleetStatusMessage(`${created.length} specialist(s) created — re-run to include them in the fleet`);
            }
            document.getElementById('specialist-panel')?.classList.add('hidden');
        } catch (e) {
            console.error('Specialist approval failed', e);
            if (btn) { btn.disabled = false; btn.textContent = '✅ Create Selected & Re-run'; }
        }
    }

    document.getElementById('specialist-approve-btn')?.addEventListener('click', approveSpecialists);
    document.getElementById('specialist-dismiss-btn')?.addEventListener('click', () => {
        document.getElementById('specialist-panel')?.classList.add('hidden');
        _pendingProposals = [];
    });


});  // end DOMContentLoaded
