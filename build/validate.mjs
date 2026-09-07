#!/usr/bin/env node
// Structural checks on the built workflow. Catches the mistakes that only show
// up as a silent no-op after you import into n8n: a connection pointing at a
// renamed node, a node with no path from a trigger, an AI sub-node that was
// never attached, a `$('Node')` reference to a node that does not exist.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = JSON.parse(readFileSync(join(root, 'workflows/job-application-automation.json'), 'utf8'));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

// --- shape -----------------------------------------------------------------
for (const key of ['name', 'nodes', 'connections', 'settings']) {
  if (!(key in workflow)) fail(`workflow is missing top-level "${key}"`);
}

const nodes = workflow.nodes ?? [];
const byName = new Map();
const ids = new Set();

for (const node of nodes) {
  for (const key of ['id', 'name', 'type', 'typeVersion', 'position', 'parameters']) {
    if (node[key] === undefined) fail(`node "${node.name ?? node.id}" is missing "${key}"`);
  }
  if (byName.has(node.name)) fail(`duplicate node name "${node.name}" - n8n expressions address nodes by name`);
  if (ids.has(node.id)) fail(`duplicate node id "${node.id}"`);
  if (!Array.isArray(node.position) || node.position.length !== 2) fail(`node "${node.name}" has a malformed position`);
  byName.set(node.name, node);
  ids.add(node.id);
}

const isSticky = (node) => node.type === 'n8n-nodes-base.stickyNote';
const real = nodes.filter((n) => !isSticky(n));

// --- connections -----------------------------------------------------------
const inbound = new Map();
for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
  if (!byName.has(source)) fail(`connections reference unknown source node "${source}"`);
  for (const [outputType, branches] of Object.entries(outputs)) {
    if (!Array.isArray(branches)) fail(`"${source}".${outputType} is not an array of branches`);
    branches.forEach((branch, branchIndex) => {
      if (branch === null) return; // an intentionally empty branch
      for (const target of branch) {
        if (!byName.has(target.node)) {
          fail(`"${source}".${outputType}[${branchIndex}] points at unknown node "${target.node}"`);
          continue;
        }
        if (target.type !== outputType) {
          fail(`"${source}" -> "${target.node}" mixes output type ${outputType} with target type ${target.type}`);
        }
        inbound.set(target.node, (inbound.get(target.node) ?? 0) + 1);
      }
    });
  }
}

// --- reachability ----------------------------------------------------------
const triggers = real.filter((n) => /trigger$/i.test(n.type) || n.type.endsWith('.manualTrigger'));
if (triggers.length === 0) fail('workflow has no trigger node');

const reachable = new Set(triggers.map((n) => n.name));
const queue = [...reachable];
while (queue.length) {
  const current = queue.shift();
  for (const branches of Object.values(workflow.connections?.[current] ?? {})) {
    for (const branch of branches) {
      for (const target of branch ?? []) {
        if (!reachable.has(target.node)) {
          reachable.add(target.node);
          queue.push(target.node);
        }
      }
    }
  }
}

// AI sub-nodes attach *upward*, so they are roots of their own, not reachable
// from a trigger. Verify they are attached to something instead.
const AI_TYPES = ['ai_languageModel', 'ai_outputParser', 'ai_memory', 'ai_tool', 'ai_embedding'];
for (const node of real) {
  const outputs = workflow.connections?.[node.name] ?? {};
  const attachesUpward = Object.keys(outputs).some((type) => AI_TYPES.includes(type));
  if (attachesUpward) {
    if (!Object.values(outputs).some((branches) => branches.some((b) => (b ?? []).length > 0))) {
      fail(`AI sub-node "${node.name}" is not attached to any parent node`);
    }
    continue;
  }
  if (!reachable.has(node.name)) fail(`node "${node.name}" is unreachable from any trigger`);
}

// Every parent that declares an AI input should have one wired.
for (const node of real) {
  if (!node.type.startsWith('@n8n/n8n-nodes-langchain.chainLlm')) continue;
  const attached = new Set();
  for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
    for (const [type, branches] of Object.entries(outputs)) {
      for (const branch of branches) {
        for (const target of branch ?? []) {
          if (target.node === node.name) attached.add(type);
        }
      }
    }
  }
  if (!attached.has('ai_languageModel')) fail(`"${node.name}" has no language model attached`);
  if (node.parameters.hasOutputParser === true && !attached.has('ai_outputParser')) {
    fail(`"${node.name}" sets hasOutputParser but no output parser is attached`);
  }
}

// --- expression references -------------------------------------------------
const serialised = JSON.stringify(workflow);
for (const match of serialised.matchAll(/\\?['"]?\$\('([^']+)'\)/g)) {
  const referenced = match[1];
  if (!byName.has(referenced)) fail(`an expression references $('${referenced}'), which is not a node in this workflow`);
}

// --- config placeholders ---------------------------------------------------
const config = byName.get('Config');
if (!config) {
  fail('no "Config" node found');
} else {
  const placeholders = (config.parameters.assignments?.assignments ?? [])
    .filter((a) => typeof a.value === 'string' && a.value.startsWith('PUT_'))
    .map((a) => a.name);
  if (placeholders.length === 0) warnings.push('Config has no PUT_ placeholders left - is a real ID committed?');
  else warnings.push(`Config placeholders a user must fill in: ${placeholders.join(', ')}`);
}

// --- code nodes ------------------------------------------------------------
for (const node of real.filter((n) => n.type === 'n8n-nodes-base.code')) {
  const js = node.parameters.jsCode ?? '';
  if (!js.trim()) fail(`code node "${node.name}" has no jsCode`);
  if (!/\breturn\b/.test(js)) fail(`code node "${node.name}" never returns`);
}

// --- report ----------------------------------------------------------------
for (const warning of warnings) console.log(`note:  ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);

console.log(
  errors.length === 0
    ? `\nOK - ${real.length} nodes, ${nodes.length - real.length} sticky notes, ${reachable.size} reachable from a trigger.`
    : `\nFAILED with ${errors.length} error(s).`,
);
process.exit(errors.length === 0 ? 0 : 1);
