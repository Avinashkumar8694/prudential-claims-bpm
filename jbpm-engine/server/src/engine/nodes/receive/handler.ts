// Receive task — waits for a matching message (resumed by a send/throw broadcast or the signal API).
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = (c) => ({ wait: { kind: 'message', ref: c.node.message } });
