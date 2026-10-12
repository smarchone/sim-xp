// node --test mvp/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSim, validatePlaybook } from '../js/engine.js';

const dir = new URL('../playbooks/', import.meta.url);
const ids = JSON.parse(fs.readFileSync(new URL('index.json', dir)));
const load = (id) => JSON.parse(fs.readFileSync(new URL(`${id}.json`, dir)));

function play(pb, plan = {}) {
  const sim = createSim(pb);
  while (!sim.state.done) {
    for (const a of plan[sim.state.t] || []) sim.act(a);
    sim.step();
  }
  return sim;
}

test('every listed playbook validates', () => {
  for (const id of ids) assert.deepEqual(validatePlaybook(load(id)), [], id);
});

test('same playbook, seed and actions give the same run', () => {
  const pb = load(ids[0]);
  const plan = { 230: ['rate_limit'], 280: ['warm_cache'] };
  assert.deepEqual(play(pb, plan).state.samples, play(pb, plan).state.samples);
});

test('flash sale: the author path beats doing nothing and beats the scaling reflex', () => {
  const pb = load('flash-sale-pool-exhaustion');
  const nothing = play(pb).debrief();
  const reflex = play(pb, { 240: ['scale_api'], 330: ['scale_api'] }).debrief();
  const expert = play(pb, { 230: ['declare_incident', 'rate_limit'], 250: ['disable_retries', 'post_update'], 280: ['warm_cache'], 400: ['remove_rate_limit'] }).debrief();
  assert.ok(expert.availability_pct > reflex.availability_pct);
  assert.ok(expert.availability_pct > nothing.availability_pct);
  assert.ok(expert.mitigated_at_s != null);
  assert.equal(reflex.pitfalls_hit.length, 1);
});

test('gc spiral: restarts alone do not count as mitigation, rollback does', () => {
  const pb = load('gc-death-spiral');
  assert.equal(play(pb, { 300: ['restart_api'], 420: ['restart_api'] }).debrief().mitigated_at_s, null);
  assert.notEqual(play(pb, { 300: ['rollback', 'restart_api'] }).debrief().mitigated_at_s, null);
});
