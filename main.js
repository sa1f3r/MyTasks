const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    masterFilePath: 'Tasks.md',
    statusPrefix: '@status/',
    projectPrefix: '@project/',
    priorityPrefix: '@p/',
    startDatePrefix: '🛫 ',
    dueDatePrefix: '📅 ',
    completionDatePrefix: '✅ ',
    doneStatusId: 'done',
    statuses: [
        { id: 'todo', label: 'To Do', color: '#7f8c8d' },
        { id: 'in_progress', label: 'In Progress', color: '#f39c12' },
        { id: 'done', label: 'Done', color: '#2ecc71' }
    ]
};

const PRIORITY_LABELS = {
    1: { label: 'P1: Маловажно', class: 'tt-p1', badge: 'P1' },
    2: { label: 'P2: Низкий', class: 'tt-p2', badge: 'P2' },
    3: { label: 'P3: Средний', class: 'tt-p3', badge: 'P3' },
    4: { label: 'P4: Высокий', class: 'tt-p4', badge: 'P4' },
    5: { label: 'P5: Очень важно', class: 'tt-p5', badge: 'P5' }
};

const PASTEL_COLORS = [
    '#e06c75', '#d19a66', '#e5c07b', '#98c379', 
    '#56b6c2', '#61afef', '#c678dd', '#d16d94', 
    '#4ba3e3', '#42b883', '#f39c12', '#e74c3c'
];

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDateOffset(daysOffset = 0, baseDateStr = null) {
    let d = new Date();
    if (baseDateStr) {
        const parts = baseDateStr.split('-').map(Number);
        d = new Date(parts[0], parts[1] - 1, parts[2]);
    }
    d.setDate(d.getDate() + daysOffset);
    return formatDate(d);
}

function formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDaysDiff(dateStr1, dateStr2) {
    const p1 = dateStr1.split('-').map(Number);
    const p2 = dateStr2.split('-').map(Number);
    const d1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
    const d2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function addDaysToDateStr(dateStr, days) {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return formatDate(d);
}

// Поисковый подсказчик для выбора файлов из хранилища (Autocomplete)
class FileSuggest extends obsidian.AbstractInputSuggest {
    constructor(app, inputEl) {
        super(app, inputEl);
        this.inputEl = inputEl;
    }

    getSuggestions(query) {
        const files = this.app.vault.getMarkdownFiles();
        const lowerQuery = query.toLowerCase().trim();
        return files.filter(file => file.path.toLowerCase().includes(lowerQuery));
    }

    renderSuggestion(file, el) {
        el.setText(file.path);
    }

    selectSuggestion(file) {
        this.inputEl.value = file.path;
        this.inputEl.dispatchEvent(new Event('input'));
        this.close();
    }
}

class TaskEngine {
    static async getAllProjects(app, settings) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return ['Общие задачи'];

        const content = await app.vault.read(file);
        const lines = content.split('\n');
        const projects = new Set(['Общие задачи']);

        const projTagRegex = new RegExp(`${escapeRegExp(settings.projectPrefix)}([^\\s]+)`, 'gi');

        lines.forEach(line => {
            const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
            if (headingMatch) {
                const title = headingMatch[1].trim();
                if (title) projects.add(title);
            }

            let match;
            while ((match = projTagRegex.exec(line)) !== null) {
                const projName = match[1].replace(/_/g, ' ').trim();
                if (projName) projects.add(projName);
            }
        });

        return Array.from(projects);
    }

    static async parseMasterFile(app, settings) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return [];

        const content = await app.vault.read(file);
        const lines = content.split('\n');
        const tasks = [];
        let currentHeaderProject = 'Общие задачи';
        let fileNeedsUpdate = false;

        const parentStack = [];

        for (let index = 0; index < lines.length; index++) {
            let line = lines[index];

            const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
            if (headingMatch) {
                currentHeaderProject = headingMatch[1].trim();
                parentStack.length = 0;
                continue;
            }

            const taskMatch = line.match(/^(\s*)-\s*\[([ x/])\]\s*(.*)$/);
            if (taskMatch) {
                const indent = taskMatch[1].length;
                const checkChar = taskMatch[2];
                let rawText = taskMatch[3];

                while (parentStack.length > 0 && parentStack[parentStack.length - 1].indent >= indent) {
                    parentStack.pop();
                }
                const parentTask = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

                let status = checkChar === 'x' ? settings.doneStatusId : 'todo';
                if (checkChar === '/') status = 'in_progress';

                const statusRegex = new RegExp(`${escapeRegExp(settings.statusPrefix)}([\\w_-]+)`, 'i');
                const statusMatch = rawText.match(statusRegex);
                if (statusMatch) {
                    status = statusMatch[1];
                    rawText = rawText.replace(statusMatch[0], '');
                }

                let priority = 1;
                const priorityRegex = new RegExp(`${escapeRegExp(settings.priorityPrefix)}([1-5])`, 'i');
                const priorityMatch = rawText.match(priorityRegex);
                if (priorityMatch) {
                    priority = parseInt(priorityMatch[1], 10);
                    rawText = rawText.replace(priorityMatch[0], '');
                }

                let project = currentHeaderProject;
                const projectRegex = new RegExp(`${escapeRegExp(settings.projectPrefix)}([^\\s]+)`, 'i');
                const projectMatch = rawText.match(projectRegex);

                if (projectMatch) {
                    project = projectMatch[1].replace(/_/g, ' ').trim();
                    rawText = rawText.replace(projectMatch[0], '');
                } else {
                    const projTag = `${settings.projectPrefix}${project.replace(/\s+/g, '_')}`;
                    lines[index] = `${lines[index]} ${projTag}`;
                    fileNeedsUpdate = true;
                }

                let startDate, dueDate, completionDate;

                const startRegex = new RegExp(`${escapeRegExp(settings.startDatePrefix)}(\\d{4}-\\d{2}-\\d{2})`, 'i');
                const startMatch = rawText.match(startRegex);
                if (startMatch) {
                    startDate = startMatch[1];
                    rawText = rawText.replace(startMatch[0], '');
                }

                const dueRegex = new RegExp(`${escapeRegExp(settings.dueDatePrefix)}(\\d{4}-\\d{2}-\\d{2})`, 'i');
                const dueMatch = rawText.match(dueRegex);
                if (dueMatch) {
                    dueDate = dueMatch[1];
                    rawText = rawText.replace(dueMatch[0], '');
                }

                const compRegex = new RegExp(`${escapeRegExp(settings.completionDatePrefix)}(\\d{4}-\\d{2}-\\d{2})`, 'i');
                const compMatch = rawText.match(compRegex);
                if (compMatch) {
                    completionDate = compMatch[1];
                    rawText = rawText.replace(compMatch[0], '');
                }

                const cleanedText = rawText.trim();

                const taskObj = {
                    id: `task-${index}`,
                    rawLine: lines[index],
                    lineIndex: index,
                    text: cleanedText,
                    completed: checkChar === 'x',
                    status,
                    priority,
                    startDate,
                    dueDate,
                    completionDate,
                    project,
                    indentLevel: indent,
                    parentText: parentTask ? parentTask.text : null
                };

                tasks.push(taskObj);
                parentStack.push({ indent, text: cleanedText });
            }
        }

        if (fileNeedsUpdate) {
            await app.vault.modify(file, lines.join('\n'));
        }

        return tasks;
    }

    static async updateTaskStatus(app, settings, task, newStatus) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return;

        const content = await app.vault.read(file);
        const lines = content.split('\n');

        let line = lines[task.lineIndex];
        if (!line) return;

        const isDone = newStatus === settings.doneStatusId;
        const checkChar = isDone ? 'x' : (newStatus === 'in_progress' ? '/' : ' ');
        line = line.replace(/^((\s*)-\s*\[)(.)(\])/, `$1${checkChar}$4`);

        const statusRegex = new RegExp(`${escapeRegExp(settings.statusPrefix)}[\\w_-]+`, 'i');
        const newTag = `${settings.statusPrefix}${newStatus}`;

        if (statusRegex.test(line)) {
            line = line.replace(statusRegex, newTag);
        } else {
            line = `${line} ${newTag}`;
        }

        const compRegex = new RegExp(`\\s*${escapeRegExp(settings.completionDatePrefix)}\\d{4}-\\d{2}-\\d{2}`, 'gi');
        line = line.replace(compRegex, '');

        if (isDone) {
            const todayStr = formatDateOffset(0);
            line = `${line} ${settings.completionDatePrefix}${todayStr}`;
        }

        lines[task.lineIndex] = line;
        await app.vault.modify(file, lines.join('\n'));
    }

    static async updateTaskPriority(app, settings, task, newPriority) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return;

        const content = await app.vault.read(file);
        const lines = content.split('\n');

        let line = lines[task.lineIndex];
        if (!line) return;

        const priorityRegex = new RegExp(`${escapeRegExp(settings.priorityPrefix)}[1-5]`, 'i');
        const newTag = `${settings.priorityPrefix}${newPriority}`;

        if (priorityRegex.test(line)) {
            line = line.replace(priorityRegex, newTag);
        } else {
            line = `${line} ${newTag}`;
        }

        lines[task.lineIndex] = line;
        await app.vault.modify(file, lines.join('\n'));
    }

    static async updateTaskText(app, settings, task, newText) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return;

        const content = await app.vault.read(file);
        const lines = content.split('\n');

        let line = lines[task.lineIndex];
        if (!line) return;

        lines[task.lineIndex] = line.replace(task.text, newText);
        await app.vault.modify(file, lines.join('\n'));
    }

    static async updateTaskDates(app, settings, task, newStartDate, newDueDate) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return;

        const content = await app.vault.read(file);
        const lines = content.split('\n');

        let line = lines[task.lineIndex];
        if (!line) return;

        const startRegex = new RegExp(`\\s*${escapeRegExp(settings.startDatePrefix)}\\d{4}-\\d{2}-\\d{2}`, 'gi');
        const dueRegex = new RegExp(`\\s*${escapeRegExp(settings.dueDatePrefix)}\\d{4}-\\d{2}-\\d{2}`, 'gi');

        line = line.replace(startRegex, '').replace(dueRegex, '');

        if (newStartDate) {
            line = `${line} ${settings.startDatePrefix}${newStartDate}`;
        }
        if (newDueDate) {
            line = `${line} ${settings.dueDatePrefix}${newDueDate}`;
        }

        lines[task.lineIndex] = line;
        await app.vault.modify(file, lines.join('\n'));
    }

    static async openAndHighlightTask(app, settings, lineIndex) {
        const file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) return;

        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file);

        const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor;
        if (editor) {
            editor.setCursor({ line: lineIndex, ch: 0 });
            editor.scrollIntoView({ from: { line: lineIndex, ch: 0 }, to: { line: lineIndex, ch: 0 } }, true);
            editor.setSelection(
                { line: lineIndex, ch: 0 },
                { line: lineIndex, ch: editor.getLine(lineIndex).length }
            );
        }
    }

    static async addProject(app, settings, projectName) {
        let file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) {
            file = await app.vault.create(settings.masterFilePath, '');
        }
        const content = await app.vault.read(file);
        const newContent = `${content.trim()}\n\n### ${projectName}\n`;
        await app.vault.modify(file, newContent);
    }

    static async addTask(app, settings, projectName, taskText, status, priority, startDate, dueDate) {
        let file = app.vault.getAbstractFileByPath(settings.masterFilePath);
        if (!(file instanceof obsidian.TFile)) {
            file = await app.vault.create(settings.masterFilePath, '');
        }

        const content = await app.vault.read(file);
        const lines = content.split('\n');
        let projectLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const hMatch = lines[i].match(/^#{1,6}\s+(.*)$/);
            if (hMatch && hMatch[1].trim() === projectName) {
                projectLineIndex = i;
                break;
            }
        }

        const formattedProjTag = `${settings.projectPrefix}${projectName.replace(/\s+/g, '_')}`;
        const statusTag = `${settings.statusPrefix}${status}`;
        const priorityTag = `${settings.priorityPrefix}${priority || 1}`;
        
        let taskLine = `- [ ] ${taskText} ${statusTag} ${priorityTag} ${formattedProjTag}`;
        if (startDate) taskLine += ` ${settings.startDatePrefix}${startDate}`;
        if (dueDate) taskLine += ` ${settings.dueDatePrefix}${dueDate}`;

        if (projectLineIndex !== -1) {
            lines.splice(projectLineIndex + 1, 0, taskLine);
        } else {
            lines.push(`\n### ${projectName}`, taskLine);
        }

        await app.vault.modify(file, lines.join('\n'));
    }
}

class TaskTrackerView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentMode = 'calendar';
        this.selectedProjectFilter = 'ALL';
        this.treeStatusPosition = 'end';
        this.tasks = [];
        this.allProjects = [];
        this.calendarYear = new Date().getFullYear();
        this.calendarMonth = new Date().getMonth();
    }

    getViewType() { return 'custom-task-tracker-view'; }
    getDisplayText() { return 'Task Tracker'; }
    getIcon() { return 'kanban'; }

    async onOpen() {
        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file.path === this.plugin.settings.masterFilePath) {
                    await this.refresh();
                }
            })
        );
        await this.refresh();
    }

    async refresh() {
        this.tasks = await TaskEngine.parseMasterFile(this.app, this.plugin.settings);
        this.allProjects = await TaskEngine.getAllProjects(this.app, this.plugin.settings);
        this.renderUI();
    }

    getFilteredTasks() {
        if (this.selectedProjectFilter === 'ALL') return this.tasks;
        return this.tasks.filter(t => t.project === this.selectedProjectFilter);
    }

    openTaskContextMenu(event, task) {
        event.preventDefault();
        event.stopPropagation();

        const menu = new obsidian.Menu();

        menu.addItem(item => {
            item.setTitle('Статус').setIcon('check-square');
            const subMenu = item.setSubmenu();
            this.plugin.settings.statuses.forEach(st => {
                subMenu.addItem(sub => {
                    sub.setTitle(st.label)
                        .setChecked(task.status === st.id)
                        .onClick(async () => {
                            await TaskEngine.updateTaskStatus(this.app, this.plugin.settings, task, st.id);
                            await this.refresh();
                        });
                });
            });
        });

        menu.addItem(item => {
            item.setTitle('Приоритет').setIcon('flag');
            const subMenu = item.setSubmenu();
            [1, 2, 3, 4, 5].forEach(p => {
                const pInfo = PRIORITY_LABELS[p];
                subMenu.addItem(sub => {
                    sub.setTitle(pInfo.label)
                        .setChecked(task.priority === p)
                        .onClick(async () => {
                            await TaskEngine.updateTaskPriority(this.app, this.plugin.settings, task, p);
                            await this.refresh();
                        });
                });
            });
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle('Сдвинуть дедлайн').setIcon('calendar-plus');
            const subMenu = item.setSubmenu();
            const baseDue = task.dueDate || formatDateOffset(0);

            subMenu.addItem(sub => {
                sub.setTitle('+1 день').onClick(async () => {
                    const newDue = addDaysToDateStr(baseDue, 1);
                    await TaskEngine.updateTaskDates(this.app, this.plugin.settings, task, task.startDate, newDue);
                    await this.refresh();
                });
            });

            subMenu.addItem(sub => {
                sub.setTitle('+2 дня').onClick(async () => {
                    const newDue = addDaysToDateStr(baseDue, 2);
                    await TaskEngine.updateTaskDates(this.app, this.plugin.settings, task, task.startDate, newDue);
                    await this.refresh();
                });
            });

            subMenu.addItem(sub => {
                sub.setTitle('+1 неделя').onClick(async () => {
                    const newDue = addDaysToDateStr(baseDue, 7);
                    await TaskEngine.updateTaskDates(this.app, this.plugin.settings, task, task.startDate, newDue);
                    await this.refresh();
                });
            });
        });

        menu.addItem(item => {
            item.setTitle('Изменить даты...').setIcon('calendar')
                .onClick(() => {
                    new EditDatesModal(this.app, this.plugin, task, () => this.refresh()).open();
                });
        });

        menu.addSeparator();

        menu.addItem(item => {
            item.setTitle('Переименовать').setIcon('edit')
                .onClick(() => {
                    new EditTaskTextModal(this.app, this.plugin, task, () => this.refresh()).open();
                });
        });

        menu.addItem(item => {
            item.setTitle('Перейти к файлу').setIcon('file-text')
                .onClick(() => {
                    TaskEngine.openAndHighlightTask(this.app, this.plugin.settings, task.lineIndex);
                });
        });

        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    renderUI() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('task-tracker-container');

        const header = container.createDiv({ cls: 'task-tracker-header' });
        header.createEl('h3', { text: '🎯 Task Hub' });

        const controls = header.createDiv({ cls: 'task-tracker-controls' });

        const projDropdown = controls.createDiv({ cls: 'tt-project-filter-dropdown' });
        const currentProjectName = this.selectedProjectFilter === 'ALL' ? '📁 Все проекты' : `📂 ${this.selectedProjectFilter}`;
        projDropdown.createSpan({ text: currentProjectName });
        projDropdown.createSpan({ text: '▼', cls: 'tt-dropdown-arrow' });

        projDropdown.onclick = (e) => {
            const menu = new obsidian.Menu();
            menu.addItem(item => {
                item.setTitle('📁 Все проекты')
                    .setChecked(this.selectedProjectFilter === 'ALL')
                    .onClick(() => {
                        this.selectedProjectFilter = 'ALL';
                        this.renderUI();
                    });
            });
            menu.addSeparator();
            this.allProjects.forEach(p => {
                menu.addItem(item => {
                    item.setTitle(`📂 ${p}`)
                        .setChecked(this.selectedProjectFilter === p)
                        .onClick(() => {
                            this.selectedProjectFilter = p;
                            this.renderUI();
                        });
                });
            });
            menu.showAtPosition({ x: e.clientX, y: e.clientY });
        };

        const viewSwitcher = controls.createDiv({ cls: 'tt-view-switcher' });
        const createViewTab = (mode, label, icon) => {
            const tab = viewSwitcher.createEl('button', { 
                cls: `tt-view-tab ${this.currentMode === mode ? 'is-active' : ''}`, 
                text: `${icon} ${label}` 
            });
            tab.onclick = () => {
                this.currentMode = mode;
                this.renderUI();
            };
        };
        createViewTab('tree', 'Древо', '🌳');
        createViewTab('kanban', 'Канбан', '📋');
        createViewTab('calendar', 'Календарь', '📅');

        const btnAdd = controls.createEl('button', { text: '+ Задача', cls: 'mod-cta' });
        const btnAddProj = controls.createEl('button', { text: '+ Проект' });

        btnAdd.onclick = () => new AddTaskModal(this.app, this.plugin, () => this.refresh()).open();
        btnAddProj.onclick = () => new AddProjectModal(this.app, this.plugin, () => this.refresh()).open();

        const mainContent = container.createDiv({ cls: 'task-tracker-view-content' });

        if (this.currentMode === 'kanban') this.renderKanban(mainContent);
        else if (this.currentMode === 'tree') this.renderTree(mainContent);
        else if (this.currentMode === 'calendar') this.renderCalendar(mainContent);
    }

    renderKanban(parent) {
        const board = parent.createDiv({ cls: 'tt-kanban-board' });
        const filteredTasks = this.getFilteredTasks();

        this.plugin.settings.statuses.forEach(status => {
            const col = board.createDiv({ cls: 'tt-kanban-column' });
            const colHeader = col.createDiv({ cls: 'tt-kanban-column-header' });
            colHeader.createSpan({ text: status.label });
            colHeader.style.borderBottomColor = status.color;

            col.addEventListener('dragover', (e) => {
                e.preventDefault();
                col.addClass('tt-drag-over');
            });

            col.addEventListener('dragleave', () => {
                col.removeClass('tt-drag-over');
            });

            col.addEventListener('drop', async (e) => {
                e.preventDefault();
                col.removeClass('tt-drag-over');
                const rawData = e.dataTransfer.getData('text/plain');
                if (rawData) {
                    const data = JSON.parse(rawData);
                    const task = this.tasks.find(t => t.lineIndex === data.lineIndex);
                    if (task && task.status !== status.id) {
                        await TaskEngine.updateTaskStatus(this.app, this.plugin.settings, task, status.id);
                        await this.refresh();
                    }
                }
            });

            const colTasks = filteredTasks.filter(t => t.status === status.id);

            colTasks.forEach(task => {
                const isSubtask = task.indentLevel > 0 || task.parentText;
                const card = col.createDiv({ cls: `tt-kanban-card ${isSubtask ? 'tt-subtask-card' : ''}` });
                card.setAttribute('draggable', 'true');

                card.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ lineIndex: task.lineIndex }));
                    card.style.opacity = '0.4';
                });

                card.addEventListener('dragend', () => {
                    card.style.opacity = '1';
                });

                card.onclick = (e) => {
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                        TaskEngine.openAndHighlightTask(this.app, this.plugin.settings, task.lineIndex);
                    }
                };

                card.oncontextmenu = (e) => this.openTaskContextMenu(e, task);

                const topMeta = card.createDiv({ cls: 'tt-card-top-meta' });
                topMeta.createDiv({ cls: 'tt-card-project', text: `📁 ${task.project}` });

                const pInfo = PRIORITY_LABELS[task.priority || 1];
                const pBadge = topMeta.createSpan({ text: pInfo.badge, cls: `tt-priority-badge ${pInfo.class}` });
                pBadge.title = pInfo.label;

                if (task.parentText) {
                    card.createDiv({ cls: 'tt-subtask-indicator', text: `↳ ${task.parentText}` });
                }

                card.createDiv({ text: task.text, cls: 'tt-card-title' });

                const datesDiv = card.createDiv({ cls: 'tt-card-dates' });
                if (task.startDate) datesDiv.createDiv({ cls: 'tt-date-tag', text: `🛫 ${task.startDate}` });
                if (task.dueDate) datesDiv.createDiv({ cls: 'tt-date-tag', text: `📅 ${task.dueDate}` });
                if (task.completionDate) datesDiv.createDiv({ cls: 'tt-date-tag', text: `✅ ${task.completionDate}` });
            });
        });
    }

    renderTree(parent) {
        const toolbar = parent.createDiv({ cls: 'tt-tree-toolbar' });
        const toggleBtn = toolbar.createEl('button', { 
            text: `📌 Статус: ${this.treeStatusPosition === 'end' ? 'В конце строки' : 'Рядом с текстом'}` 
        });
        toggleBtn.onclick = () => {
            this.treeStatusPosition = this.treeStatusPosition === 'end' ? 'inline' : 'end';
            this.renderUI();
        };

        const filteredTasks = this.getFilteredTasks();
        const projects = Array.from(new Set(filteredTasks.map(t => t.project)));

        projects.forEach(proj => {
            const block = parent.createDiv({ cls: 'tt-project-block' });
            block.createEl('h4', { text: `📂 ${proj}`, cls: 'tt-project-title' });

            const projTasks = filteredTasks.filter(t => t.project === proj);
            const activeTasks = projTasks.filter(t => !t.completed);
            const doneTasks = projTasks.filter(t => t.completed);

            const renderTaskItem = (task, isDone = false) => {
                const item = block.createDiv({ cls: `tt-task-item ${isDone ? 'tt-task-item-done' : ''}` });
                item.style.marginLeft = `${task.indentLevel * 12}px`;

                const check = item.createEl('input', { type: 'checkbox' });
                check.checked = task.completed;
                check.onclick = (e) => e.stopPropagation();
                check.onchange = async () => {
                    const nextStatus = check.checked ? this.plugin.settings.doneStatusId : 'todo';
                    await TaskEngine.updateTaskStatus(this.app, this.plugin.settings, task, nextStatus);
                    await this.refresh();
                };

                const pInfo = PRIORITY_LABELS[task.priority || 1];
                const pBadge = item.createSpan({ text: pInfo.badge, cls: `tt-priority-badge ${pInfo.class}` });
                pBadge.title = pInfo.label;

                const stConfig = this.plugin.settings.statuses.find(s => s.id === task.status);

                if (this.treeStatusPosition === 'inline') {
                    if (stConfig) {
                        const badge = item.createSpan({ text: stConfig.label, cls: 'tt-status-badge' });
                        badge.style.backgroundColor = stConfig.color;
                    }
                    item.createSpan({ text: task.text, cls: 'tt-task-text' });
                    if (task.dueDate) item.createSpan({ cls: 'tt-date-tag', text: `📅 ${task.dueDate}` });
                    if (task.completionDate) item.createSpan({ cls: 'tt-date-tag', text: `✅ ${task.completionDate}` });
                } else {
                    item.createSpan({ text: task.text, cls: 'tt-task-text' });
                    if (task.dueDate) item.createSpan({ cls: 'tt-date-tag', text: `📅 ${task.dueDate}` });
                    if (task.completionDate) item.createSpan({ cls: 'tt-date-tag', text: `✅ ${task.completionDate}` });
                    if (stConfig) {
                        const badge = item.createSpan({ text: stConfig.label, cls: 'tt-status-badge' });
                        badge.style.backgroundColor = stConfig.color;
                    }
                }

                item.onclick = (e) => {
                    if (e.target !== check) {
                        TaskEngine.openAndHighlightTask(this.app, this.plugin.settings, task.lineIndex);
                    }
                };

                item.oncontextmenu = (e) => this.openTaskContextMenu(e, task);
            };

            activeTasks.forEach(task => renderTaskItem(task, false));

            if (doneTasks.length > 0) {
                const divider = block.createDiv({ cls: 'tt-done-divider' });
                divider.createSpan({ text: `Завершенные (${doneTasks.length})` });
                doneTasks.forEach(task => renderTaskItem(task, true));
            }
        });
    }

    attachTaskDragEvents(el, task) {
        el.setAttribute('draggable', 'true');

        el.addEventListener('dragstart', (e) => {
            el.addClass('tt-is-dragging');

            const ghost = document.createElement('div');
            ghost.className = 'tt-drag-ghost';
            ghost.textContent = task.text;

            const stConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
            ghost.style.backgroundColor = stConfig ? stConfig.color : 'var(--interactive-accent)';

            document.body.appendChild(ghost);

            if (e.dataTransfer && e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(ghost, 15, 15);
            }

            e.dataTransfer.setData('text/plain', JSON.stringify({ lineIndex: task.lineIndex }));

            setTimeout(() => ghost.remove(), 0);
        });

        el.addEventListener('dragend', () => {
            el.removeClass('tt-is-dragging');
        });
    }

    attachBarResizeEvents(barEl, task) {
        const leftHandle = barEl.querySelector('.tt-handle-left');
        const rightHandle = barEl.querySelector('.tt-handle-right');

        const startResize = (e, handleType) => {
            e.stopPropagation();
            e.preventDefault();

            document.body.classList.add('tt-resizing-active');
            let targetDate = handleType === 'left' ? (task.startDate || task.dueDate) : (task.dueDate || task.startDate);

            const onMouseMove = (moveEvent) => {
                const dayCells = Array.from(document.querySelectorAll('.tt-calendar-day'));
                let hoveredCell = null;

                for (const cell of dayCells) {
                    const rect = cell.getBoundingClientRect();
                    if (
                        moveEvent.clientX >= rect.left &&
                        moveEvent.clientX <= rect.right &&
                        moveEvent.clientY >= rect.top &&
                        moveEvent.clientY <= rect.bottom
                    ) {
                        hoveredCell = cell;
                        break;
                    }
                }

                document.querySelectorAll('.tt-day-resize-target').forEach(el => el.classList.remove('tt-day-resize-target'));

                if (hoveredCell && hoveredCell.dataset.date) {
                    targetDate = hoveredCell.dataset.date;
                    hoveredCell.classList.add('tt-day-resize-target');
                }
            };

            const onMouseUp = async () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                document.body.classList.remove('tt-resizing-active');
                document.querySelectorAll('.tt-day-resize-target').forEach(el => el.classList.remove('tt-day-resize-target'));

                if (targetDate) {
                    let newStart = task.startDate || task.dueDate;
                    let newDue = task.dueDate || task.startDate;

                    if (handleType === 'left') {
                        newStart = targetDate;
                        if (newStart > newDue) newDue = newStart;
                    } else {
                        newDue = targetDate;
                        if (newDue < newStart) newStart = newDue;
                    }

                    await TaskEngine.updateTaskDates(this.app, this.plugin.settings, task, newStart, newDue);
                    await this.refresh();
                }
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

        if (leftHandle) {
            leftHandle.addEventListener('mousedown', (e) => startResize(e, 'left'));
        }
        if (rightHandle) {
            rightHandle.addEventListener('mousedown', (e) => startResize(e, 'right'));
        }
    }

    renderCalendar(parent) {
        const calendarContainer = parent.createDiv({ cls: 'tt-calendar-container' });
        const filteredTasks = this.getFilteredTasks();

        const sidebar = calendarContainer.createDiv({ cls: 'tt-unscheduled-sidebar' });
        const unscheduledTasks = filteredTasks.filter(t => !t.startDate && !t.dueDate);
        sidebar.createEl('h4', { text: `📋 Без даты (${unscheduledTasks.length})` });

        const unscheduledList = sidebar.createDiv({ cls: 'tt-unscheduled-list' });
        unscheduledTasks.forEach(task => {
            const card = unscheduledList.createDiv({ cls: 'tt-unscheduled-card' });

            const topRow = card.createDiv({ cls: 'tt-unscheduled-card-top' });
            topRow.createDiv({ cls: 'tt-card-project', text: `📁 ${task.project}` });

            const badgesDiv = topRow.createDiv({ cls: 'tt-card-badges' });
            const stConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
            if (stConfig) {
                const stBadge = badgesDiv.createSpan({ text: stConfig.label, cls: 'tt-status-badge' });
                stBadge.style.backgroundColor = stConfig.color;
            }
            const pInfo = PRIORITY_LABELS[task.priority || 1];
            const pBadge = badgesDiv.createSpan({ text: pInfo.badge, cls: `tt-priority-badge ${pInfo.class}` });
            pBadge.title = pInfo.label;

            if (task.parentText) {
                card.createDiv({ cls: 'tt-subtask-indicator', text: `↳ ${task.parentText}` });
            }

            card.createDiv({ cls: 'tt-unscheduled-card-text', text: task.text });

            this.attachTaskDragEvents(card, task);

            card.onclick = (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                    TaskEngine.openAndHighlightTask(this.app, this.plugin.settings, task.lineIndex);
                }
            };

            card.oncontextmenu = (e) => this.openTaskContextMenu(e, task);
        });

        const mainArea = calendarContainer.createDiv({ cls: 'tt-calendar-main' });

        const nav = mainArea.createDiv({ cls: 'tt-calendar-nav' });
        const prevBtn = nav.createEl('button', { text: '◀' });

        const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
        nav.createSpan({ text: `${monthNames[this.calendarMonth]} ${this.calendarYear}`, cls: 'tt-calendar-nav-title' });

        const nextBtn = nav.createEl('button', { text: '▶' });

        prevBtn.onclick = () => {
            this.calendarMonth--;
            if (this.calendarMonth < 0) {
                this.calendarMonth = 11;
                this.calendarYear--;
            }
            this.renderUI();
        };

        nextBtn.onclick = () => {
            this.calendarMonth++;
            if (this.calendarMonth > 11) {
                this.calendarMonth = 0;
                this.calendarYear++;
            }
            this.renderUI();
        };

        const weekdaysHeader = mainArea.createDiv({ cls: 'tt-calendar-weekdays' });
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(w => weekdaysHeader.createDiv({ text: w }));

        const weeks = this.getWeeksForMonth(this.calendarYear, this.calendarMonth);
        const weeksGrid = mainArea.createDiv({ cls: 'tt-calendar-weeks-grid' });

        const scheduledTasks = filteredTasks.filter(t => t.startDate || t.dueDate);

        weeks.forEach(weekDays => {
            const weekRow = weeksGrid.createDiv({ cls: 'tt-calendar-week-row' });
            const bgGrid = weekRow.createDiv({ cls: 'tt-week-days-bg' });

            weekDays.forEach((dayInfo) => {
                const dayCell = bgGrid.createDiv({
                    cls: `tt-calendar-day ${!dayInfo.isCurrentMonth ? 'tt-other-month' : ''}`
                });
                dayCell.dataset.date = dayInfo.dateStr;
                dayCell.createDiv({ text: `${dayInfo.dayNum}`, cls: 'tt-day-number' });

                dayCell.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dayCell.addClass('tt-day-drag-over');
                });

                dayCell.addEventListener('dragleave', () => {
                    dayCell.removeClass('tt-day-drag-over');
                });

                dayCell.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    dayCell.removeClass('tt-day-drag-over');
                    const rawData = e.dataTransfer.getData('text/plain');
                    if (rawData) {
                        const data = JSON.parse(rawData);
                        const task = this.tasks.find(t => t.lineIndex === data.lineIndex);
                        if (task) {
                            let newStart = dayInfo.dateStr;
                            let newDue = dayInfo.dateStr;

                            if (task.startDate && task.dueDate && task.startDate !== task.dueDate) {
                                const durationDays = getDaysDiff(task.startDate, task.dueDate);
                                if (durationDays > 0) {
                                    newDue = addDaysToDateStr(newStart, durationDays);
                                }
                            }

                            await TaskEngine.updateTaskDates(this.app, this.plugin.settings, task, newStart, newDue);
                            await this.refresh();
                        }
                    }
                });
            });

            const tasksLayer = weekRow.createDiv({ cls: 'tt-week-tasks-layer' });
            const weekStartStr = weekDays[0].dateStr;
            const weekEndStr = weekDays[6].dateStr;

            const weekTasks = scheduledTasks.filter(t => {
                const tStart = t.startDate || t.dueDate;
                const tDue = t.dueDate || t.startDate;
                return tStart <= weekEndStr && tDue >= weekStartStr;
            });

            weekTasks.sort((a, b) => {
                const aStart = a.startDate || a.dueDate;
                const bStart = b.startDate || b.dueDate;
                if (aStart !== bStart) return aStart.localeCompare(bStart);
                const aLen = getDaysDiff(aStart, a.dueDate || a.startDate);
                const bLen = getDaysDiff(bStart, b.dueDate || b.startDate);
                return bLen - aLen;
            });

            const occupiedSlots = [];

            weekTasks.forEach(task => {
                const tStart = task.startDate || task.dueDate;
                const tDue = task.dueDate || task.startDate;

                let startColIndex = weekDays.findIndex(d => d.dateStr === tStart);
                if (startColIndex === -1) startColIndex = 0;

                let endColIndex = weekDays.findIndex(d => d.dateStr === tDue);
                if (endColIndex === -1) endColIndex = 6;

                const startCol = startColIndex + 1;
                const colSpan = endColIndex - startColIndex + 1;

                let rowIndex = 1;
                while (true) {
                    let slotAvailable = true;
                    for (let c = startColIndex; c <= endColIndex; c++) {
                        if (occupiedSlots[c] && occupiedSlots[c][rowIndex]) {
                            slotAvailable = false;
                            break;
                        }
                    }
                    if (slotAvailable) break;
                    rowIndex++;
                }

                for (let c = startColIndex; c <= endColIndex; c++) {
                    if (!occupiedSlots[c]) occupiedSlots[c] = [];
                    occupiedSlots[c][rowIndex] = true;
                }

                const stConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
                const barColor = stConfig ? stConfig.color : 'var(--interactive-accent)';

                const bar = tasksLayer.createDiv({ cls: 'tt-calendar-bar' });
                bar.style.gridColumn = `${startCol} / span ${colSpan}`;
                bar.style.gridRow = `${rowIndex}`;
                bar.style.backgroundColor = barColor;

                bar.createDiv({ cls: 'tt-handle tt-handle-left', title: 'Изменить дату начала' });

                const pInfo = PRIORITY_LABELS[task.priority || 1];
                const pBadge = bar.createSpan({ text: pInfo.badge, cls: `tt-priority-badge ${pInfo.class} tt-bar-p-badge` });
                pBadge.title = pInfo.label;

                bar.createSpan({ cls: 'tt-bar-title', text: task.text });

                bar.createDiv({ cls: 'tt-handle tt-handle-right', title: 'Изменить дедлайн' });

                this.attachBarResizeEvents(bar, task);
                this.attachTaskDragEvents(bar, task);

                bar.onclick = (e) => {
                    if (!e.target.classList.contains('tt-handle')) {
                        e.stopPropagation();
                        TaskEngine.openAndHighlightTask(this.app, this.plugin.settings, task.lineIndex);
                    }
                };

                bar.oncontextmenu = (e) => this.openTaskContextMenu(e, task);
            });
        });
    }

    getWeeksForMonth(year, month) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        let dayOfWeek = firstDay.getDay() - 1;
        if (dayOfWeek === -1) dayOfWeek = 6;

        const weeks = [];
        let currentWeek = [];

        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = dayOfWeek - 1; i >= 0; i--) {
            const d = new Date(year, month - 1, prevMonthLastDay - i);
            currentWeek.push({ dateStr: formatDate(d), dayNum: d.getDate(), isCurrentMonth: false });
        }

        for (let d = 1; d <= lastDay.getDate(); d++) {
            const dateObj = new Date(year, month, d);
            currentWeek.push({ dateStr: formatDate(dateObj), dayNum: d, isCurrentMonth: true });
            if (currentWeek.length === 7) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
        }

        if (currentWeek.length > 0) {
            let nextD = 1;
            while (currentWeek.length < 7) {
                const d = new Date(year, month + 1, nextD);
                currentWeek.push({ dateStr: formatDate(d), dayNum: d.getDate(), isCurrentMonth: false });
                nextD++;
            }
            weeks.push(currentWeek);
        }

        return weeks;
    }
}

class EditDatesModal extends obsidian.Modal {
    constructor(app, plugin, task, onSuccess) {
        super(app);
        this.plugin = plugin;
        this.task = task;
        this.onSuccess = onSuccess;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: `Даты: ${this.task.text}` });

        let startDate = this.task.startDate || '';
        let dueDate = this.task.dueDate || '';

        new obsidian.Setting(contentEl)
            .setName('Дата начала')
            .addText(t => {
                t.inputEl.type = 'date';
                t.setValue(startDate);
                t.onChange(v => startDate = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Дедлайн')
            .addText(t => {
                t.inputEl.type = 'date';
                t.setValue(dueDate);
                t.onChange(v => dueDate = v);
            });

        new obsidian.Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Сохранить')
                .setCta()
                .onClick(async () => {
                    await TaskEngine.updateTaskDates(this.app, this.plugin.settings, this.task, startDate, dueDate);
                    this.close();
                    this.onSuccess();
                }));
    }
}

class EditTaskTextModal extends obsidian.Modal {
    constructor(app, plugin, task, onSuccess) {
        super(app);
        this.plugin = plugin;
        this.task = task;
        this.onSuccess = onSuccess;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Переименовать задачу' });

        let newText = this.task.text;

        new obsidian.Setting(contentEl)
            .setName('Текст задачи')
            .addText(t => {
                t.setValue(newText);
                t.onChange(v => newText = v);
            });

        new obsidian.Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Сохранить')
                .setCta()
                .onClick(async () => {
                    if (newText.trim()) {
                        await TaskEngine.updateTaskText(this.app, this.plugin.settings, this.task, newText.trim());
                        this.close();
                        this.onSuccess();
                    }
                }));
    }
}

class AddProjectModal extends obsidian.Modal {
    constructor(app, plugin, onSuccess) {
        super(app);
        this.plugin = plugin;
        this.onSuccess = onSuccess;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Добавить новый проект' });

        let name = '';
        new obsidian.Setting(contentEl)
            .setName('Название проекта')
            .addText(text => text.onChange(v => name = v));

        new obsidian.Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Создать')
                .setCta()
                .onClick(async () => {
                    if (name.trim()) {
                        await TaskEngine.addProject(this.app, this.plugin.settings, name.trim());
                        this.close();
                        this.onSuccess();
                    }
                }));
    }
}

class AddTaskModal extends obsidian.Modal {
    constructor(app, plugin, onSuccess) {
        super(app);
        this.plugin = plugin;
        this.onSuccess = onSuccess;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Добавить задачу' });

        const projects = await TaskEngine.getAllProjects(this.app, this.plugin.settings);

        let selectedProject = projects[0] || 'Общие задачи';
        let taskText = '';
        let selectedStatus = this.plugin.settings.statuses[0]?.id || 'todo';
        let selectedPriority = 1;
        let startDate = '';
        let dueDate = '';

        new obsidian.Setting(contentEl)
            .setName('Проект')
            .addDropdown(dd => {
                projects.forEach(p => dd.addOption(p, p));
                dd.onChange(v => selectedProject = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Текст задачи')
            .addTextArea(text => {
                text.inputEl.rows = 4;
                text.inputEl.style.width = '100%';
                text.onChange(v => taskText = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Статус')
            .addDropdown(dd => {
                this.plugin.settings.statuses.forEach(s => dd.addOption(s.id, s.label));
                dd.onChange(v => selectedStatus = v);
            });

        new obsidian.Setting(contentEl)
            .setName('Приоритет')
            .addDropdown(dd => {
                [1, 2, 3, 4, 5].forEach(p => dd.addOption(String(p), PRIORITY_LABELS[p].label));
                dd.setValue('1');
                dd.onChange(v => selectedPriority = parseInt(v, 10));
            });

        const startDateSetting = new obsidian.Setting(contentEl)
            .setName('Дата начала')
            .setDesc('Выберите дату начала выполнения');

        const startContainer = startDateSetting.controlEl.createDiv({ cls: 'tt-modal-date-picker' });
        const startInput = startContainer.createEl('input', { type: 'date', cls: 'tt-styled-date-input' });
        startInput.onchange = (e) => startDate = e.target.value;

        const startPresets = startContainer.createDiv({ cls: 'tt-date-presets' });
        const addStartPreset = (label, days) => {
            const btn = startPresets.createEl('span', { text: label, cls: 'tt-preset-chip' });
            btn.onclick = () => {
                startDate = formatDateOffset(days);
                startInput.value = startDate;
            };
        };
        addStartPreset('Сегодня', 0);
        addStartPreset('Завтра', 1);
        addStartPreset('+2 дня', 2);
        addStartPreset('Неделя', 7);

        const dueDateSetting = new obsidian.Setting(contentEl)
            .setName('Дедлайн')
            .setDesc('Ожидаемая дата выполнения');

        const dueContainer = dueDateSetting.controlEl.createDiv({ cls: 'tt-modal-date-picker' });
        const dueInput = dueContainer.createEl('input', { type: 'date', cls: 'tt-styled-date-input' });
        dueInput.onchange = (e) => dueDate = e.target.value;

        const duePresets = dueContainer.createDiv({ cls: 'tt-date-presets' });
        const addDuePreset = (label, days) => {
            const btn = duePresets.createEl('span', { text: label, cls: 'tt-preset-chip' });
            btn.onclick = () => {
                dueDate = formatDateOffset(days);
                dueInput.value = dueDate;
            };
        };
        addDuePreset('Сегодня', 0);
        addDuePreset('Завтра', 1);
        addDuePreset('+2 дня', 2);
        addDuePreset('Неделя', 7);

        new obsidian.Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Сохранить')
                .setCta()
                .onClick(async () => {
                    if (taskText.trim()) {
                        await TaskEngine.addTask(
                            this.app,
                            this.plugin.settings,
                            selectedProject,
                            taskText.trim(),
                            selectedStatus,
                            selectedPriority,
                            startDate,
                            dueDate
                        );
                        this.close();
                        this.onSuccess();
                    }
                }));
    }
}

class TaskTrackerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Настройки Task Tracker' });

        // Выбор мастер-файла с автодополнением (FileSuggest)
        new obsidian.Setting(containerEl)
            .setName('Мастер-файл заметок')
            .setDesc('Путь к файлу, где хранятся задачи (начните ввод для автопоиска по хранилищу)')
            .addText(text => {
                text.setValue(this.plugin.settings.masterFilePath)
                    .onChange(async (val) => {
                        this.plugin.settings.masterFilePath = val;
                        await this.plugin.saveSettings();
                    });
                new FileSuggest(this.app, text.inputEl);
            });

        // Настройка горячей клавиши
        new obsidian.Setting(containerEl)
            .setName('Горячая клавиша: Быстрое создание задачи')
            .setDesc('По умолчанию назначен хоткей Ctrl+Alt+T (Cmd+Option+T). Нажмите для переназначения в меню Obsidian.')
            .addButton(btn => btn
                .setButtonText('Настроить хоткей')
                .onClick(() => {
                    const settingModal = this.app.setting;
                    settingModal.open();
                    settingModal.openTabById('hotkeys');
                    const searchInput = settingModal.activeTab?.searchComponent;
                    if (searchInput) {
                        searchInput.setValue(`${this.plugin.manifest.name}: Быстрое создание задачи`);
                        searchInput.inputEl.dispatchEvent(new Event('input'));
                    }
                }));

        new obsidian.Setting(containerEl)
            .setName('Завершающий статус (Done)')
            .setDesc('Выберите статус, который отмечает задачу выполненной [x]')
            .addDropdown(dd => {
                this.plugin.settings.statuses.forEach(s => dd.addOption(s.id, s.label));
                dd.setValue(this.plugin.settings.doneStatusId);
                dd.onChange(async (val) => {
                    this.plugin.settings.doneStatusId = val;
                    await this.plugin.saveSettings();
                });
            });

        containerEl.createEl('h3', { text: 'Порядок и редактор статусов (Drag & Drop)' });

        let draggedIndex = null;
        const listContainer = containerEl.createDiv({ cls: 'tt-status-settings-list' });

        this.plugin.settings.statuses.forEach((status, idx) => {
            const item = listContainer.createDiv({ cls: 'tt-status-settings-item' });
            item.setAttribute('draggable', 'true');

            item.createSpan({ text: '☰', cls: 'tt-drag-handle' });

            const idInput = item.createEl('input', { type: 'text', value: status.id, placeholder: 'ID' });
            idInput.style.width = '80px';
            idInput.onchange = async (e) => {
                this.plugin.settings.statuses[idx].id = e.target.value;
                await this.plugin.saveSettings();
            };

            const labelInput = item.createEl('input', { type: 'text', value: status.label, placeholder: 'Название' });
            labelInput.style.width = '110px';
            labelInput.onchange = async (e) => {
                this.plugin.settings.statuses[idx].label = e.target.value;
                await this.plugin.saveSettings();
            };

            const colorWrap = item.createDiv({ cls: 'tt-status-color-wrap' });

            const textHexInput = colorWrap.createEl('input', { type: 'text', value: status.color, placeholder: '#HEX' });
            textHexInput.style.width = '75px';

            const colorWheelInput = colorWrap.createEl('input', { type: 'color', value: status.color });

            const chipsGrid = colorWrap.createDiv({ cls: 'tt-pastel-chips-grid' });
            PASTEL_COLORS.forEach(hex => {
                const chip = chipsGrid.createDiv({ cls: 'tt-pastel-chip' });
                chip.style.backgroundColor = hex;
                if (status.color.toLowerCase() === hex.toLowerCase()) {
                    chip.addClass('tt-chip-selected');
                }
                chip.onclick = async () => {
                    status.color = hex;
                    textHexInput.value = hex;
                    colorWheelInput.value = hex;
                    await this.plugin.saveSettings();
                    this.display();
                };
            });

            textHexInput.onchange = async (e) => {
                let val = e.target.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                status.color = val;
                colorWheelInput.value = val;
                await this.plugin.saveSettings();
            };

            colorWheelInput.onchange = async (e) => {
                const val = e.target.value;
                status.color = val;
                textHexInput.value = val;
                await this.plugin.saveSettings();
                this.display();
            };

            const delBtn = item.createEl('button', { text: '❌' });
            delBtn.onclick = async () => {
                this.plugin.settings.statuses.splice(idx, 1);
                await this.plugin.saveSettings();
                this.display();
            };

            item.addEventListener('dragstart', () => {
                draggedIndex = idx;
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
                draggedIndex = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            item.addEventListener('drop', async (e) => {
                e.preventDefault();
                if (draggedIndex !== null && draggedIndex !== idx) {
                    const movedItem = this.plugin.settings.statuses.splice(draggedIndex, 1)[0];
                    this.plugin.settings.statuses.splice(idx, 0, movedItem);
                    await this.plugin.saveSettings();
                    this.display();
                }
            });
        });

        new obsidian.Setting(containerEl)
            .addButton(btn => btn.setButtonText('+ Добавить статус').onClick(async () => {
                this.plugin.settings.statuses.push({ id: `status_${Date.now()}`, label: 'Новый статус', color: '#56b6c2' });
                await this.plugin.saveSettings();
                this.display();
            }));
    }
}

class TaskTrackerPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.registerView(
            'custom-task-tracker-view',
            (leaf) => new TaskTrackerView(leaf, this)
        );

        this.addRibbonIcon('check-square', 'Custom Task Tracker', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-task-tracker',
            name: 'Открыть плагин трекера задач',
            callback: () => this.activateView()
        });

        // Команда для быстрого создания задачи через хоткей
        this.addCommand({
            id: 'quick-add-task',
            name: 'Быстрое создание задачи',
            hotkeys: [
                {
                    modifiers: ['Mod', 'Alt'],
                    key: 't'
                }
            ],
            callback: () => {
                new AddTaskModal(this.app, this, () => {
                    const leaf = this.app.workspace.getLeavesOfType('custom-task-tracker-view')[0];
                    if (leaf && leaf.view instanceof TaskTrackerView) {
                        leaf.view.refresh();
                    }
                }).open();
            }
        });

        this.addSettingTab(new TaskTrackerSettingTab(this.app, this));
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType('custom-task-tracker-view')[0];
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: 'custom-task-tracker-view',
                active: true,
            });
        }
        workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    saveSettings() {
        return this.saveData(this.settings);
    }
}

module.exports = TaskTrackerPlugin;