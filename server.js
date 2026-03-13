const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const app = express();
const PORT = 3001;
const WORKSPACE = '/root/.openclaw/workspace';

// Basic Auth credentials (can be overridden by env vars)
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'fahrizal';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || '@Facriz3f';

// Parse JSON bodies
app.use(express.json());

// Basic Auth middleware
app.use((req, res, next) => {
    const auth = req.headers.authorization || '';

    if (!auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Monitoring Dashboard"');
        return res.status(401).send('Authentication required');
    }

    try {
        const b64 = auth.split(' ')[1] || '';
        const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');

        if (user === DASHBOARD_USER && pass === DASHBOARD_PASS) {
            return next();
        }
    } catch (e) {
        // fall through to unauthorized
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Monitoring Dashboard"');
    return res.status(401).send('Unauthorized');
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Get CPU usage
async function getCPUUsage() {
    try {
        const result = await execAsync("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'");
        const usage = Math.round(parseFloat(result.stdout.trim()) || 0);
        return {
            usage: usage,
            cores: os.cpus().length
        };
    } catch (error) {
        // Fallback method
        const cpus = os.cpus();
        const loadAvg = os.loadavg()[0];
        const usage = Math.min(100, Math.round((loadAvg / cpus.length) * 100));
        return {
            usage: usage,
            cores: cpus.length
        };
    }
}

// Get memory usage
function getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        percent: Math.round((usedMem / totalMem) * 100)
    };
}

// Get storage usage
async function getStorageUsage() {
    try {
        const result = await execAsync('df -h /');
        const lines = result.stdout.split('\n');
        const parts = lines[1].split(/\s+/);
        
        const total = parseInt(parts[1]) * 1024 * 1024; // Convert GB to bytes
        const used = parseInt(parts[2]) * 1024 * 1024;
        const available = parseInt(parts[3]) * 1024 * 1024;
        
        return {
            total: total,
            used: used,
            available: available,
            percent: parseInt(parts[4])
        };
    } catch (error) {
        return {
            total: 0,
            used: 0,
            available: 0,
            percent: 0
        };
    }
}

// Parse cron expression
function parseCronExpression(expr) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return null;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek, ...commandParts] = parts;
    const command = commandParts.join(' ');
    
    return {
        minute,
        hour,
        dayOfMonth,
        month,
        dayOfWeek,
        command
    };
}

// Format cron expression for display
function formatCronExpression(cron) {
    const parts = [
        cron.minute,
        cron.hour,
        cron.dayOfMonth,
        cron.month,
        cron.dayOfWeek
    ].join(' ');
    
    return parts + ' ' + cron.command;
}

// Get next run time for cron
function getNextRunTime(cron) {
    try {
        const cronToSchedule = `${cron.minute} ${cron.hour} ${cron.dayOfMonth} ${cron.month} ${cron.dayOfWeek} *`;
        const result = execSync(`echo "${cronToSchedule}" | systemd-analyze calendar`, { encoding: 'utf8' });
        const lines = result.split('\n');
        const nextLine = lines.find(l => l.includes('Normalized form'));
        if (nextLine) {
            const timeStr = nextLine.split('→')[1]?.trim();
            return timeStr || 'Unknown';
        }
        return 'Unknown';
    } catch (error) {
        return 'Unknown';
    }
}

// Get cron jobs
async function getCronJobs() {
    try {
        const result = await execAsync('crontab -l');
        const lines = result.stdout.split('\n');
        const jobs = [];
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) return;
            
            const parsed = parseCronExpression(trimmed);
            if (parsed) {
                jobs.push({
                    id: index,
                    raw: trimmed,
                    minute: parsed.minute,
                    hour: parsed.hour,
                    dayOfMonth: parsed.dayOfMonth,
                    month: parsed.month,
                    dayOfWeek: parsed.dayOfWeek,
                    command: parsed.command
                });
            }
        });
        
        return jobs;
    } catch (error) {
        if (error.message.includes('no crontab for')) {
            return []; // No crontab exists yet
        }
        console.error('Error fetching cron jobs:', error);
        return [];
    }
}

// Add cron job
async function addCronJob(expression) {
    try {
        // Get current crontab
        let currentCrontab = '';
        try {
            const result = await execAsync('crontab -l');
            currentCrontab = result.stdout;
        } catch (error) {
            // No crontab exists yet, that's fine
        }
        
        // Append new job
        const newCrontab = currentCrontab + expression + '\n';
        
        // Write new crontab
        await execAsync(`echo '${newCrontab}' | crontab -`);
        
        return { success: true };
    } catch (error) {
        console.error('Error adding cron job:', error);
        return { success: false, error: error.message };
    }
}

// Delete cron job by line number
async function deleteCronJob(lineNumber) {
    try {
        const result = await execAsync('crontab -l');
        const lines = result.stdout.split('\n');
        
        // Filter out the line to delete (skip comments and empty lines when counting)
        let jobIndex = 0;
        const newLines = lines.filter((line, index) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return true; // Keep comments and empty lines
            
            if (jobIndex === lineNumber) {
                jobIndex++;
                return false; // Delete this job
            }
            jobIndex++;
            return true;
        });
        
        if (newLines.length === 0 || newLines.every(l => !l.trim() || l.trim().startsWith('#'))) {
            // No jobs left, remove crontab
            await execAsync('crontab -r');
        } else {
            // Write new crontab
            await execAsync(`echo '${newLines.join('\n')}' | crontab -`);
        }
        
        return { success: true };
    } catch (error) {
        console.error('Error deleting cron job:', error);
        return { success: false, error: error.message };
    }
}

// Update cron job
async function updateCronJob(lineNumber, newExpression) {
    try {
        const result = await execAsync('crontab -l');
        const lines = result.stdout.split('\n');
        
        let jobIndex = 0;
        const newLines = lines.map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line; // Keep comments and empty lines
            
            if (jobIndex === lineNumber) {
                jobIndex++;
                return newExpression; // Replace this job
            }
            jobIndex++;
            return line;
        });
        
        // Write new crontab
        await execAsync(`echo '${newLines.join('\n')}' | crontab -`);
        
        return { success: true };
    } catch (error) {
        console.error('Error updating cron job:', error);
        return { success: false, error: error.message };
    }
}

// Get PM2 processes
async function getPM2Processes() {
    try {
        const result = await execAsync('pm2 jlist');
        const processes = JSON.parse(result.stdout);
        
        return processes.map(proc => ({
            pid: proc.pid,
            name: proc.name,
            status: proc.pm2_env.status,
            uptime: proc.pm2_env.pm_uptime,
            cpu: proc.monit.cpu,
            memory: proc.monit.memory,
            restarts: proc.pm2_env.restart_time,
            cwd: proc.pm2_env.cwd,
            script: proc.pm2_env.pm_exec_path
        }));
    } catch (error) {
        console.error('Error fetching PM2 processes:', error);
        return [];
    }
}

// Get PM2 logs for a specific process
async function getPM2Logs(name, lines = 100) {
    try {
        const result = await execAsync(`pm2 logs ${name} --nostream --lines ${lines}`);
        return {
            name: name,
            logs: result.stdout,
            success: true
        };
    } catch (error) {
        console.error('Error fetching PM2 logs:', error);
        return {
            name: name,
            logs: '',
            success: false,
            error: error.message
        };
    }
}

// Get list of processes (like htop)
async function getProcesses() {
    try {
        // Use ps to get process list with CPU and memory percentages
        const result = await execAsync('ps aux --sort=-%cpu | head -30');
        const lines = result.stdout.split('\n').slice(1); // Skip header
        
        const processes = [];
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            // Parse ps aux output
            // USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
            const parts = line.trim().split(/\s+/);
            
            if (parts.length < 11) continue;
            
            const user = parts[0];
            const pid = parseInt(parts[1]);
            const cpu = parseFloat(parts[2]);
            const mem = parseFloat(parts[3]);
            const vsz = parseInt(parts[4]);
            const rss = parseInt(parts[5]);
            const stat = parts[7];
            const command = parts.slice(10).join(' ');
            
            processes.push({
                pid,
                user,
                cpu,
                mem,
                vsz,
                rss,
                stat,
                command: command.length > 100 ? command.substring(0, 100) + '...' : command
            });
        }
        
        return processes;
    } catch (error) {
        console.error('Error fetching processes:', error);
        return [];
    }
}

// Get processes sorted by memory
async function getProcessesByMemory() {
    try {
        const result = await execAsync('ps aux --sort=-%mem | head -30');
        const lines = result.stdout.split('\n').slice(1);
        
        const processes = [];
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            const parts = line.trim().split(/\s+/);
            
            if (parts.length < 11) continue;
            
            const user = parts[0];
            const pid = parseInt(parts[1]);
            const cpu = parseFloat(parts[2]);
            const mem = parseFloat(parts[3]);
            const vsz = parseInt(parts[4]);
            const rss = parseInt(parts[5]);
            const stat = parts[7];
            const command = parts.slice(10).join(' ');
            
            processes.push({
                pid,
                user,
                cpu,
                mem,
                vsz,
                rss,
                stat,
                command: command.length > 100 ? command.substring(0, 100) + '...' : command
            });
        }
        
        return processes;
    } catch (error) {
        console.error('Error fetching processes:', error);
        return [];
    }
}

// Get files in a directory
function getFiles(dir) {
    try {
        const items = fs.readdirSync(dir);
        const files = items.map(item => {
            const fullPath = path.join(dir, item);
            const stats = fs.statSync(fullPath);
            
            return {
                name: item,
                path: fullPath,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime
            };
        }).sort((a, b) => {
            // Sort directories first, then files
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });
        
        return files;
    } catch (error) {
        console.error('Error reading directory:', error);
        return [];
    }
}

// Get file content
function getFileContent(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        
        const buffer = fs.readFileSync(filePath);
        const nullBytes = buffer.indexOf('\x00');
        const isBinary = nullBytes !== -1 || (buffer.length > 1000 && buffer.toString('utf8').replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '').length / buffer.length < 0.7);
        
        return {
            name: path.basename(filePath),
            path: filePath,
            content: isBinary ? null : content,
            isBinary: isBinary,
            size: stats.size,
            modified: stats.mtime
        };
    } catch (error) {
        console.error('Error reading file:', error);
        return null;
    }
}

// Get breadcrumbs for a path
function getBreadcrumbs(currentPath, basePath) {
    if (currentPath === basePath) return [];
    
    const relPath = path.relative(basePath, currentPath);
    const parts = relPath.split(path.sep);
    
    const breadcrumbs = [{ name: 'workspace', path: basePath }];
    let accumPath = basePath;
    
    parts.forEach((part, index) => {
        accumPath = path.join(accumPath, part);
        breadcrumbs.push({ name: part, path: accumPath });
    });
    
    return breadcrumbs;
}

// API endpoint for system stats
app.get('/api/stats', async (req, res) => {
    try {
        const [cpu, ram, storage] = await Promise.all([
            getCPUUsage(),
            Promise.resolve(getMemoryUsage()),
            getStorageUsage()
        ]);
        
        res.json({
            cpu: cpu,
            ram: ram,
            storage: storage,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// API endpoint for processes
app.get('/api/processes', async (req, res) => {
    try {
        const sortBy = req.query.sort || 'cpu'; // 'cpu' or 'memory'
        
        let processes;
        if (sortBy === 'memory') {
            processes = await getProcessesByMemory();
        } else {
            processes = await getProcesses();
        }
        
        res.json({ processes });
    } catch (error) {
        console.error('Error fetching processes:', error);
        res.status(500).json({ error: 'Failed to fetch processes' });
    }
});

// API endpoint for files in a directory
app.get('/api/files', (req, res) => {
    try {
        const requestedPath = req.query.path || WORKSPACE;
        
        const resolvedPath = path.resolve(requestedPath);
        const resolvedWorkspace = path.resolve(WORKSPACE);
        
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const files = getFiles(resolvedPath);
        const breadcrumbs = getBreadcrumbs(resolvedPath, resolvedWorkspace);
        
        res.json({
            files: files,
            currentPath: resolvedPath,
            breadcrumbs: breadcrumbs
        });
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ error: 'Failed to fetch files' });
    }
});

// API endpoint for file content
app.get('/api/file', (req, res) => {
    try {
        const filePath = req.query.path;
        
        if (!filePath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        
        const resolvedPath = path.resolve(filePath);
        const resolvedWorkspace = path.resolve(WORKSPACE);
        
        if (!resolvedPath.startsWith(resolvedWorkspace)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const fileData = getFileContent(resolvedPath);
        
        if (!fileData) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        res.json(fileData);
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// API endpoint to save file content
app.put('/api/file', (req, res) => {
    try {
        const { path: filePath, content } = req.body || {};

        if (!filePath || typeof content !== 'string') {
            return res.status(400).json({ error: 'path and content are required' });
        }

        const resolvedPath = path.resolve(filePath);
        const resolvedWorkspace = path.resolve(WORKSPACE);

        if (!resolvedPath.startsWith(resolvedWorkspace)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Prevent editing directories
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
            return res.status(400).json({ error: 'Cannot edit a directory' });
        }

        fs.writeFileSync(resolvedPath, content, 'utf-8');
        const stats = fs.statSync(resolvedPath);

        res.json({ success: true, path: resolvedPath, size: stats.size, modified: stats.mtime });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// API endpoint for cron jobs - GET
app.get('/api/cron', async (req, res) => {
    try {
        const jobs = await getCronJobs();
        res.json({ jobs });
    } catch (error) {
        console.error('Error fetching cron jobs:', error);
        res.status(500).json({ error: 'Failed to fetch cron jobs' });
    }
});

// API endpoint for cron jobs - POST (create)
app.post('/api/cron', async (req, res) => {
    try {
        const { minute, hour, dayOfMonth, month, dayOfWeek, command } = req.body;
        
        if (!command || !minute || !hour) {
            return res.status(400).json({ error: 'minute, hour, and command are required' });
        }
        
        const expression = `${minute} ${hour} ${dayOfMonth || '*'} ${month || '*'} ${dayOfWeek || '*'} ${command}`;
        const result = await addCronJob(expression);
        
        if (result.success) {
            res.json({ success: true, message: 'Cron job created successfully' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error creating cron job:', error);
        res.status(500).json({ error: 'Failed to create cron job' });
    }
});

// API endpoint for cron jobs - PUT (update)
app.put('/api/cron/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { minute, hour, dayOfMonth, month, dayOfWeek, command } = req.body;
        
        if (!command || !minute || !hour) {
            return res.status(400).json({ error: 'minute, hour, and command are required' });
        }
        
        const expression = `${minute} ${hour} ${dayOfMonth || '*'} ${month || '*'} ${dayOfWeek || '*'} ${command}`;
        const result = await updateCronJob(parseInt(id), expression);
        
        if (result.success) {
            res.json({ success: true, message: 'Cron job updated successfully' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error updating cron job:', error);
        res.status(500).json({ error: 'Failed to update cron job' });
    }
});

// API endpoint for cron jobs - DELETE
app.delete('/api/cron/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await deleteCronJob(parseInt(id));
        
        if (result.success) {
            res.json({ success: true, message: 'Cron job deleted successfully' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error deleting cron job:', error);
        res.status(500).json({ error: 'Failed to delete cron job' });
    }
});

// API endpoint for PM2 processes
app.get('/api/pm2/list', async (req, res) => {
    try {
        const processes = await getPM2Processes();
        res.json({ processes });
    } catch (error) {
        console.error('Error fetching PM2 processes:', error);
        res.status(500).json({ error: 'Failed to fetch PM2 processes' });
    }
});

// API endpoint for PM2 logs
app.get('/api/pm2/logs/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const { lines } = req.query;
        const result = await getPM2Logs(name, lines ? parseInt(lines) : 100);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error fetching PM2 logs:', error);
        res.status(500).json({ error: 'Failed to fetch PM2 logs' });
    }
});

function isSafeProcessName(name) {
    return /^[a-zA-Z0-9._:-]+$/.test(name);
}

async function runPM2Action(name, action) {
    try {
        if (!isSafeProcessName(name)) {
            return { success: false, error: 'Invalid process name' };
        }

        const allowed = ['restart', 'stop', 'start'];
        if (!allowed.includes(action)) {
            return { success: false, error: 'Invalid action' };
        }

        const result = await execAsync(`pm2 ${action} ${name}`);
        return {
            success: true,
            action,
            name,
            output: (result.stdout || '').trim()
        };
    } catch (error) {
        return {
            success: false,
            action,
            name,
            error: error.message
        };
    }
}

// API endpoint for PM2 actions (start/stop/restart)
app.post('/api/pm2/:name/:action', async (req, res) => {
    try {
        const { name, action } = req.params;
        const result = await runPM2Action(name, action);

        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Error performing PM2 action:', error);
        res.status(500).json({ success: false, error: 'Failed to perform PM2 action' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════╗
║                                                ║
║   🚀 System Dashboard is now running!          ║
║                                                ║
║   📊 Access at: http://localhost:${PORT}       ║
║   🌐 Network: http://$(hostname -I | cut -d' ' -f1):${PORT}
║                                                ║
║   Press Ctrl+C to stop                         ║
║                                                ║
╚════════════════════════════════════════════════╝
    `);
});
