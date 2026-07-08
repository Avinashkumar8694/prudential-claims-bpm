// Exhaustive DRL coverage — every way a jBPM .drl can be authored, expressed as engine JSON, and
// compiled to DRL text. Mirrors docs/bpm-assets/drl/scenarios.md (each scenario is tested here).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  compileConstraint, compilePattern, compileLhs, compileAction,
  compileFunction, compileDeclare, compileQuery,
  writeDrl, parseDrl, buildAsset, parseAsset,
  rulesToDrl, makeTypeResolver, fromEngineProject,
} from '../dist/index.mjs';

// ---------------------------------------------------------------- constraints (LHS field tests)
test('constraints — literal / var / binding / in / raw / all ops', () => {
  assert.strictEqual(compileConstraint({ field: 'amount', op: '>', value: 100000 }), 'amount > 100000');
  assert.strictEqual(compileConstraint({ field: 'status', op: '==', value: 'NEW' }), 'status == "NEW"');
  assert.strictEqual(compileConstraint({ field: 'active', op: '==', value: true }), 'active == true');
  assert.strictEqual(compileConstraint({ field: 'amount', op: '>', var: '$threshold' }), 'amount > $threshold');
  assert.strictEqual(compileConstraint({ bind: '$a', field: 'amount' }), '$a : amount');
  assert.strictEqual(compileConstraint({ field: 'type', op: 'in', value: ['DEATH', 'TI'] }), 'type in ( "DEATH", "TI" )');
  assert.strictEqual(compileConstraint({ field: 'type', op: 'not in', value: ['X'] }), 'type not in ( "X" )');
  assert.strictEqual(compileConstraint({ field: 'name', op: 'matches', value: 'A.*' }), 'name matches "A.*"');
  assert.strictEqual(compileConstraint({ field: 'tags', op: 'contains', value: 'vip' }), 'tags contains "vip"');
  assert.strictEqual(compileConstraint({ field: 'tags', op: 'not contains', var: '$x' }), 'tags not contains $x');
  assert.strictEqual(compileConstraint({ field: 'x', op: 'memberOf', var: '$list' }), 'x memberOf $list');
  assert.strictEqual(compileConstraint({ field: 'y', op: 'soundslike', value: 'smith' }), 'y soundslike "smith"');
  assert.strictEqual(compileConstraint({ raw: 'eval( $c.ok() )' }), 'eval( $c.ok() )');
});

// ---------------------------------------------------------------- patterns
test('patterns — plain / bound / constraints / from / entry-point', () => {
  assert.strictEqual(compilePattern({ fact: 'Claim' }), 'Claim(  )');
  assert.strictEqual(
    compilePattern({ fact: 'Claim', bind: '$c', constraints: [{ field: 'amount', op: '>', value: 100000 }, { field: 'status', op: '==', value: 'NEW' }] }),
    '$c : Claim( amount > 100000, status == "NEW" )');
  assert.strictEqual(compilePattern({ fact: 'Address', bind: '$a', from: '$c.addresses' }), '$a : Address(  ) from $c.addresses');
  assert.strictEqual(compilePattern({ fact: 'Event', entryPoint: 'stream' }), 'Event(  ) from entry-point "stream"');
  // field binding inside a pattern
  assert.strictEqual(compilePattern({ fact: 'Claim', constraints: [{ bind: '$amt', field: 'amount' }, { field: 'amount', op: '>', var: '$amt' }] }),
    'Claim( $amt : amount, amount > $amt )');
});

// ---------------------------------------------------------------- conditional elements
test('LHS conditional elements — and/or/not/exists/forall/eval/collect/accumulate/raw', () => {
  const p = (f) => ({ fact: f });
  assert.strictEqual(compileLhs({ and: [p('A'), p('B')] }), '( A(  ) and B(  ) )');
  assert.strictEqual(compileLhs({ or: [p('A'), p('B')] }), '( A(  ) or B(  ) )');
  assert.strictEqual(compileLhs({ not: p('A') }), 'not A(  )');
  assert.strictEqual(compileLhs({ exists: p('A') }), 'exists A(  )');
  assert.strictEqual(compileLhs({ forall: [{ fact: 'Claim', bind: '$c' }, { fact: 'Claim', bind: undefined, constraints: [{ field: 'valid', op: '==', value: true }] }] }),
    'forall ( $c : Claim(  ) Claim( valid == true ) )');
  assert.strictEqual(compileLhs({ eval: 'amount > 0' }), 'eval( amount > 0 )');
  assert.strictEqual(
    compileLhs({ collect: { pattern: { fact: 'ArrayList', bind: '$list' }, source: { fact: 'Claim', constraints: [{ field: 'status', op: '==', value: 'OPEN' }] } } }),
    '$list : ArrayList(  ) from collect( Claim( status == "OPEN" ) )');
  assert.strictEqual(
    compileLhs({ accumulate: { source: { fact: 'Claim', bind: '$c' }, bindings: [{ bind: '$sum', fn: 'sum', arg: '$c.amount' }] } }),
    'accumulate( $c : Claim(  ); $sum : sum( $c.amount ) )');
  assert.strictEqual(compileLhs({ raw: 'Number( $n : intValue > 5 )' }), 'Number( $n : intValue > 5 )');
});

// ---------------------------------------------------------------- RHS actions
test('RHS actions — modify/update/insert/insertLogical/delete/retract/call/raw + expr values', () => {
  assert.strictEqual(compileAction({ modify: '$c', set: { status: 'HIGH', reviewed: true } }),
    'modify( $c ) { setStatus( "HIGH" ), setReviewed( true ) }');
  assert.strictEqual(compileAction({ modify: '$c', set: { score: { expr: '$c.getScore() + 10' } } }),
    'modify( $c ) { setScore( $c.getScore() + 10 ) }');
  assert.strictEqual(compileAction({ update: '$c', set: { status: 'LOW' } }), '$c.setStatus( "LOW" ); update( $c );');
  assert.strictEqual(compileAction({ insert: 'new Flag($c)' }), 'insert( new Flag($c) );');
  assert.strictEqual(compileAction({ insertLogical: 'new Flag($c)' }), 'insertLogical( new Flag($c) );');
  assert.strictEqual(compileAction({ delete: '$c' }), 'delete( $c );');
  assert.strictEqual(compileAction({ retract: '$c' }), 'retract( $c );');
  assert.strictEqual(compileAction({ call: 'helper' }), 'helper();');
  assert.strictEqual(compileAction({ call: 'logger.warn', args: ['high', 42] }), 'logger.warn("high", 42);');
  assert.strictEqual(compileAction({ raw: 'System.out.println($c);' }), 'System.out.println($c);');
});

// ---------------------------------------------------------------- rule attributes
test('rule attributes — structured attrs compile to attribute lines', () => {
  const drl = writeDrl({ imports: [], globals: [], rules: [{
    name: 'R', when: '$c : Claim( )', then: 'modify( $c ) { setX( 1 ) }',
    attrs: { salience: 100, noLoop: true, dialect: 'mvel', ruleflowGroup: 'g', agendaGroup: 'ag',
      activationGroup: 'act', autoFocus: true, lockOnActive: true, enabled: true,
      dateEffective: '01-Jan-2026', dateExpires: '31-Dec-2026', duration: 5000, timer: 'int: 1s', calendars: ['weekdays'] },
  }] });
  for (const frag of ['salience 100', 'no-loop true', 'dialect "mvel"', 'ruleflow-group "g"', 'agenda-group "ag"',
    'activation-group "act"', 'auto-focus true', 'lock-on-active true', 'enabled true',
    'date-effective "01-Jan-2026"', 'date-expires "31-Dec-2026"', 'duration 5000', 'timer (int: 1s)', 'calendars "weekdays"']) {
    assert.ok(drl.includes(frag), `missing attribute: ${frag}`);
  }
});

test('rule — extends + metadata + raw attributes', () => {
  const drl = writeDrl({ imports: [], globals: [], rules: [{
    name: 'child', extends: 'parent', meta: ['@department("claims")'], attributes: ['salience 5'],
    when: 'Claim( )', then: 'System.out.println("hi");',
  }] });
  assert.ok(drl.includes('rule "child" extends "parent"'), 'extends on rule line');
  assert.ok(drl.includes('@department("claims")'), 'metadata');
  assert.ok(drl.includes('    salience 5'), 'raw attribute');
});

// ---------------------------------------------------------------- top-level constructs
test('functions — structured + string', () => {
  assert.strictEqual(compileFunction({ name: 'calcFee', returnType: 'double', params: [{ type: 'double', name: 'amount' }], body: 'return amount * 0.1;' }),
    'function double calcFee(double amount) {\n    return amount * 0.1;\n}');
  assert.strictEqual(compileFunction('function void noop() {\n}'), 'function void noop() {\n}');
});

test('declares — type declaration with annotations & fields', () => {
  const d = compileDeclare({ name: 'StockTick', extends: 'Event', annotations: ['@role( event )', '@timestamp( time )'],
    fields: [{ name: 'symbol', type: 'String' }, { name: 'price', type: 'double', annotations: ['@position(0)'] }] });
  assert.ok(d.startsWith('declare StockTick extends Event'));
  assert.ok(d.includes('    @role( event )'));
  assert.ok(d.includes('    symbol : String'));
  assert.ok(d.includes('    price : double @position(0)'));
  assert.ok(d.trimEnd().endsWith('end'));
});

test('queries — structured with params + patterns', () => {
  const q = compileQuery({ name: 'isAdult', params: [{ type: 'int', name: 'minAge' }],
    when: [{ fact: 'Person', bind: '$p', constraints: [{ field: 'age', op: '>=', var: 'minAge' }] }] });
  assert.strictEqual(q, 'query "isAdult"(int minAge)\n        $p : Person( age >= minAge )\nend');
  assert.strictEqual(compileQuery({ name: 'all', when: '$p : Person( )' }), 'query "all"\n        $p : Person( )\nend');
});

// ---------------------------------------------------------------- a full rule end to end
test('full rule — structured attrs + LHS elements + RHS actions -> DRL text', () => {
  const drl = writeDrl({
    package: 'com.acme.rules', imports: ['com.acme.model.Claim'], globals: ['java.util.List approved'],
    rules: [{
      name: 'Escalate large open claims', attrs: { ruleflowGroup: 'triage', salience: 10 },
      when: [
        { fact: 'Claim', bind: '$c', constraints: [{ field: 'amount', op: '>', value: 100000 }, { field: 'status', op: '==', value: 'OPEN' }] },
        { not: { fact: 'Reviewer', constraints: [{ field: 'assignedTo', op: '==', var: '$c' }] } },
      ],
      then: [
        { modify: '$c', set: { priority: 'HIGH' } },
        { call: 'approved.add', args: [] },
        { insert: 'new Escalation($c)' },
      ],
    }],
  });
  assert.ok(drl.includes('package com.acme.rules;'));
  assert.ok(drl.includes('import com.acme.model.Claim;'));
  assert.ok(drl.includes('global java.util.List approved;'));
  assert.ok(drl.includes('ruleflow-group "triage"') && drl.includes('salience 10'));
  assert.ok(drl.includes('$c : Claim( amount > 100000, status == "OPEN" )'));
  assert.ok(drl.includes('not Reviewer( assignedTo == $c )'));
  assert.ok(drl.includes('modify( $c ) { setPriority( "HIGH" ) }'));
  assert.ok(drl.includes('insert( new Escalation($c) );'));
  // every rule is closed
  assert.strictEqual((drl.match(/\brule\b/g) || []).length, (drl.match(/^end$/gm) || []).length);
});

// ---------------------------------------------------------------- parse + round-trip stability
test('parseDrl recovers unit / static & function imports / functions / declares / queries', () => {
  const text = `package com.acme;
unit ClaimUnit;
import com.acme.model.Claim;
import static com.acme.Util.fee;
import function com.acme.Fns.calc;
global java.util.List out;

function double dbl(double x) {
    return x * 2;
}

declare Applicant
    @role( event )
    name : String
end

query "adults"(int minAge)
    $p : Person( age >= minAge )
end

rule "R1"
    ruleflow-group "g"
    when
        $c : Claim( amount > 1 )
    then
        modify( $c ) { setOk( true ) }
end
`;
  const m = parseDrl(text);
  assert.strictEqual(m.package, 'com.acme');
  assert.strictEqual(m.unit, 'ClaimUnit');
  assert.deepStrictEqual(m.imports, ['com.acme.model.Claim']);
  assert.deepStrictEqual(m.staticImports, ['com.acme.Util.fee']);
  assert.deepStrictEqual(m.functionImports, ['com.acme.Fns.calc']);
  assert.deepStrictEqual(m.globals, ['java.util.List out']);
  assert.strictEqual(m.functions.length, 1);
  assert.ok(m.functions[0].startsWith('function double dbl'));
  assert.strictEqual(m.declares.length, 1);
  assert.ok(m.declares[0].includes('@role( event )'));
  assert.strictEqual(m.queries.length, 1);
  assert.ok(m.queries[0].includes('$p : Person'));
  assert.strictEqual(m.rules.length, 1);
  assert.strictEqual(m.rules[0].name, 'R1');
  assert.ok(m.rules[0].attributes.includes('ruleflow-group "g"'));

  // round-trip stable: parse -> build -> parse -> build is idempotent and model-stable
  const b1 = writeDrl(m); const m2 = parseDrl(b1); const b2 = writeDrl(m2);
  assert.strictEqual(b2, b1, 'writeDrl idempotent');
  assert.deepStrictEqual(m2, m, 'model stable across round-trip');
});

// ---------------------------------------------------------------- buildAsset / parseAsset integration
test('buildAsset(drl) with structured when/then + parseAsset reads it back', () => {
  const drl = buildAsset({ kind: 'drl', model: {
    package: 'com.acme.rules', imports: ['com.acme.model.Claim'], globals: [],
    rules: [{ name: 'High', attrs: { ruleflowGroup: 'classify' },
      when: [{ fact: 'Claim', bind: '$c', constraints: [{ field: 'amount', op: '>', value: 100000 }] }],
      then: [{ modify: '$c', set: { status: 'HIGH' } }] }],
  } });
  assert.ok(drl.includes('$c : Claim( amount > 100000 )') && drl.includes('modify( $c ) { setStatus( "HIGH" ) }'));
  const back = parseAsset('classify.drl', drl);
  assert.strictEqual(back.kind, 'drl');
  assert.strictEqual(back.model.rules[0].name, 'High');
  assert.ok(back.model.rules[0].attributes.includes('ruleflow-group "classify"'));
});

// ---------------------------------------------------------------- simple engine ruleset (nodejs-native)
test('rulesToDrl — simple engine JSON (no package/FQN/DRL syntax) -> full jBPM DRL', () => {
  // the whole authored input: facts by name, field/op/value, set/insert/delete. Nothing jBPM-specific.
  const ruleset = {
    group: 'classify',
    rules: [{
      name: 'High value open claim',
      priority: 10,
      when: [
        { fact: 'Claim', as: 'claim', where: { amount: { gt: 100000 }, status: 'OPEN' } },
        { fact: 'Reviewer', exists: false, where: { assigned: true } },  // exists:false -> negative match
      ],
      then: [
        { set: 'claim', fields: { status: 'HIGH' } },
        { insert: 'Escalation', fields: { level: 3 } },
      ],
    }],
  };
  // SDK resolves fact NAMES -> FQNs (from the type registry) and fills package/imports/ruleflow-group
  const resolve = makeTypeResolver([
    { name: 'Claim', package: 'com.acme.model' },
    { name: 'Reviewer', package: 'com.acme.model' },
    { name: 'Escalation', package: 'com.acme.model' },
  ]);
  const model = rulesToDrl(ruleset, resolve, 'com.acme.rules');
  const drl = buildAsset({ kind: 'drl', model });

  assert.ok(drl.includes('package com.acme.rules;'), 'package filled by SDK');
  assert.ok(drl.includes('import com.acme.model.Claim;'), 'fact name -> import');
  assert.ok(drl.includes('import com.acme.model.Escalation;'), 'inserted fact -> import');
  assert.ok(drl.includes('ruleflow-group "classify"'), 'group -> ruleflow-group');
  assert.ok(drl.includes('salience 10'));
  assert.ok(drl.includes('$claim : Claim( amount > 100000, status == "OPEN" )'), 'field/op/value -> constraint');
  assert.ok(drl.includes('not Reviewer( assigned == true )'), 'exists:false -> not pattern');
  assert.ok(drl.includes('modify( $claim ) { setStatus( "HIGH" ) }'), 'set -> modify');
  assert.ok(drl.includes('Escalation $escalation = new Escalation(); $escalation.setLevel(3); insert($escalation);'), 'insert + fields');
});

test('ruleset where — every value form (eq/op/range/in/notIn/contains/matches/ref join)', () => {
  const resolve = makeTypeResolver([{ name: 'Claim', package: 'com.acme.model' }, { name: 'FraudAlert', package: 'com.acme.model' }]);
  const model = rulesToDrl({ group: 'g', rules: [{
    name: 'R',
    when: [
      { fact: 'Claim', as: 'claim', where: {
        status: 'OPEN',                       // bare literal -> ==
        amount: { gte: 1000, lte: 100000 },   // two ops on one field -> range
        type: ['DEATH', 'TI'],                // bare array -> in
        region: { notIn: ['X'] },
        note: { matches: 'URGENT.*' },
        tags: { contains: 'vip' },
      } },
      { fact: 'FraudAlert', exists: false, where: { claimId: { ref: 'claim.id' }, open: true } },  // join
    ],
    then: [{ set: 'claim', fields: { status: 'HIGH' } }],
  }] }, resolve, 'com.acme.rules');
  const drl = buildAsset({ kind: 'drl', model });
  assert.ok(drl.includes('status == "OPEN"'), 'bare literal -> ==');
  assert.ok(drl.includes('amount >= 1000, amount <= 100000'), 'range = two constraints');
  assert.ok(drl.includes('type in ( "DEATH", "TI" )'), 'bare array -> in');
  assert.ok(drl.includes('region not in ( "X" )'), 'notIn');
  assert.ok(drl.includes('note matches "URGENT.*"'), 'matches');
  assert.ok(drl.includes('tags contains "vip"'), 'contains');
  assert.ok(drl.includes('not FraudAlert( claimId == $claim.id, open == true )'), 'ref -> cross-fact join');
});

test('fromEngineProject generates a .drl from rulesets — package optional, imports auto-filled', () => {
  const proj = fromEngineProject({
    id: 'com.acme.claims',
    // NOTE: type has NO package — the SDK defaults it to <process package>.model
    types: [{ name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'status', type: 'string' }] }],
    rulesets: [{ group: 'classify', rules: [{
      name: 'High', when: [{ fact: 'Claim', as: 'c', where: { amount: { gt: 100000 } } }], then: [{ set: 'c', fields: { status: 'HIGH' } }],
    }] }],
    processes: [{
      id: 'com.acme.claims.p', name: 'p', package: 'com.acme',
      nodes: [{ id: 's', type: 'start' }, { id: 'r', type: 'rule', ruleflowGroup: 'classify' }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 'r' }, { from: 'r', to: 'e' }],
    }],
  });
  // default path derives from the process package
  const drl = proj.descriptor.files['src/main/resources/com/acme/rules/classify.drl'];
  assert.ok(drl, 'ruleset written to a conventional .drl path');
  assert.ok(drl.includes('import com.acme.model.Claim;'), 'package defaulted to com.acme.model, import auto-filled');
  assert.ok(drl.includes('ruleflow-group "classify"') && drl.includes('$c : Claim( amount > 100000 )'));
  // the POJO lands in the defaulted package too
  assert.ok(proj.descriptor.files['src/main/java/com/acme/model/Claim.java'].includes('getAmount'));
});

test('structured and raw when/then compile identically', () => {
  const structured = writeDrl({ imports: [], globals: [], rules: [{
    name: 'R', when: [{ fact: 'Claim', bind: '$c', constraints: [{ field: 'amount', op: '>=', value: 500 }] }],
    then: [{ modify: '$c', set: { flag: true } }] }] });
  const raw = writeDrl({ imports: [], globals: [], rules: [{
    name: 'R', when: '$c : Claim( amount >= 500 )', then: 'modify( $c ) { setFlag( true ) }' }] });
  assert.strictEqual(structured, raw);
});
