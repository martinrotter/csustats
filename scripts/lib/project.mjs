import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const outputFile = new URL('../../docs/index.html', import.meta.url);
export const resolveProject = (relative) => new URL('../../' + relative, import.meta.url);
