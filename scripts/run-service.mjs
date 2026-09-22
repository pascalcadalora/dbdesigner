import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const role = process.argv[2];
if (!['api', 'web'].includes(role)) process.exit(2);
const executable = role === 'api' ? 'dotnet' : process.execPath;
const args = role === 'api'
  ? [path.join(root, '.runtime/publish/SchemaStudio.Api.dll'), '--urls', 'http://127.0.0.1:5180', '--contentRoot', path.join(root, 'api')]
  : [path.join(root, 'web/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3080'];
const child = spawn(executable, args, { cwd: path.join(root, role === 'api' ? 'api' : 'web'), stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_ENV: 'production', ASPNETCORE_ENVIRONMENT: 'Production', API_URL: 'http://127.0.0.1:5180', DataDirectory: path.join(root, 'api/App_Data'), FINANCIAL_DASHBOARD_DIRECTORY: path.resolve(root, '..', 'FinancialDashboard') } });
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { child.kill(signal); });
