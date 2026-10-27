import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], { stdio: 'inherit' });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  target: 'node20',
  sourcemap: false,
  outdir: 'dist',
  external: ['@prisma/client', 'prisma', 'argon2', 'nodemailer', 'web-push', 'ioredis'],
  logLevel: 'warning',
};
await Promise.all([
  build({ ...common, entryPoints: { index: 'src/index.ts' } }),
  build({ ...common, entryPoints: { worker: 'src/worker.ts' } }),
  build({ ...common, entryPoints: { scheduler: 'src/scheduler.ts' } }),
  build({ ...common, entryPoints: { statusServer: 'src/statusServer.ts' } }),
  build({ ...common, entryPoints: { 'cli/migrateLeader': 'src/cli/migrateLeader.ts' } }),
]);
console.log('api bundle ok');
