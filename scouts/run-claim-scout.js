import {readFile} from 'node:fs/promises';
import {run} from './digital-asset-scout.js';
const mission=await readFile(new URL('./indy-mission.txt',import.meta.url),'utf8');
const context=await readFile(new URL('./indy-asset-context.txt',import.meta.url),'utf8');
await run(mission,context);
