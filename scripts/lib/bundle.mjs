import { build } from 'esbuild';
import { projectRoot } from './project.mjs';

const options = {
  absWorkingDir: projectRoot,
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16.4'],
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'silent',
};

async function bundle(entry) {
  const result = await build({ ...options, entryPoints: [entry] });
  return result.outputFiles[0].text;
}

export const bundleApplication = () => bundle('src/main.js');
export const bundleWorker = () => bundle('src/data/index-worker.js');
