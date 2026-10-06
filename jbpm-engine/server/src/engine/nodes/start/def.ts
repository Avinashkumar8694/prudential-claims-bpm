import { type NodeDef, GENERAL } from '../def-types.ts';
// Signal/message default to '' (not a realistic-looking name) — a non-blank decoy value would
// trivially satisfy node-config's required-field check without a real name ever being picked.
// Start (Timer) seeds `on.timer` as the OBJECT shape {cycle} the 'event' widget's own timer
// sub-editor (duration/cycle/date) actually reads/writes.
export const def: NodeDef = {
  engineType: 'start',
  palette: [
    { key: 'start', label: 'Start', category: 'Events', icon: '▶', color: '#16a34a', engineType: 'start', defaults: { type: 'start', name: 'Start' } },
    { key: 'start-signal', label: 'Start (Signal)', category: 'Events', icon: '📡', color: '#16a34a', engineType: 'start', defaults: { type: 'start', on: { signal: '' } } },
    { key: 'start-message', label: 'Start (Message)', category: 'Events', icon: '✉', color: '#16a34a', engineType: 'start', defaults: { type: 'start', on: { message: '' } } },
    { key: 'start-timer', label: 'Start (Timer)', category: 'Events', icon: '⏰', color: '#16a34a', engineType: 'start', defaults: { type: 'start', on: { timer: { cycle: 'R/PT1H' } } } },
  ],
  ports: { maxIn: 0, maxOut: 1 },
  // No 'condition' trigger: a Conditional Start Event needs a continuously-monitored rule session
  // (fires the moment some condition becomes true, with no instance yet to hold the variables it
  // evaluates against) — a fundamentally different, standing-evaluation mechanism this engine has no
  // equivalent of, unlike signal/message (event-driven) and timer (scheduled).
  schema: [GENERAL, { title: 'Trigger', fields: [
    { key: 'on', label: 'Start trigger', widget: 'event', options: ['none', 'signal', 'message', 'timer'], help: 'none (default): only via POST /instances. signal: spawns a fresh instance the moment any matching Signal is thrown anywhere in the tenant (broadcast — fires this AND every other signal-start listening for the same name). message: spawns one instance only if no already-waiting instance claims the message first (point-to-point). timer: uses the schedule below — but only once this deployment is ACTIVATED, not merely deployed.' },
  ] }],
  diagram: { icon: 'play', color: '#16a34a', shape: 'circle' },
  typeLabel: 'Start event',
};
