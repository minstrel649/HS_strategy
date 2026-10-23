import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LOG_ROOT,logRoot,latestLog} from '../src/power.mjs';

test('log root follows the environment override',t=>{
  const previous=process.env.HEARTHSTONE_LOG_ROOT;
  t.after(()=>{
    if(previous===undefined)delete process.env.HEARTHSTONE_LOG_ROOT;else process.env.HEARTHSTONE_LOG_ROOT=previous;
  });
  delete process.env.HEARTHSTONE_LOG_ROOT;
  assert.equal(logRoot(),DEFAULT_LOG_ROOT);
  process.env.HEARTHSTONE_LOG_ROOT='D:/custom/Hearthstone/Logs';
  assert.equal(logRoot(),'D:/custom/Hearthstone/Logs');
});

test('missing log root reports the configured path',async()=>{
  await assert.rejects(()=>latestLog('D:/definitely-missing-hearthstone-logs'),/Hearthstone log root not found: D:\/definitely-missing-hearthstone-logs/);
});
