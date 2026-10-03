import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalUnread} from './desktop-unread.mjs';

const local='local:'+ 'a'.repeat(64),cloud='durable:'+ 'b'.repeat(64);
const data=buckets=>({'electron-thread-read-state-v1':{version:1,unreadByIdentity:{account:buckets}}});
test('read markers isolate local tasks and ignore cloud and legacy unread lists',()=>{
  const state=data({[local]:['one','one','two'],[cloud]:['cloud-only']});
  state['electron-thread-read-state-v1'].legacyMigration={unreadThreadIdsByHostId:{local:['legacy-only']}};
  assert.deepEqual(parseLocalUnread(state),{known:true,ids:['one','two']});
  assert.deepEqual(parseLocalUnread(data({[local]:[]})),{known:true,ids:[]});
});
test('ambiguous identities, host connections and invalid formats never claim current unread state',()=>{
  const multiple=data({[local]:['one']});multiple['electron-thread-read-state-v1'].unreadByIdentity.other={[local]:['two']};
  const newer=data({[local]:[]});newer['electron-thread-read-state-v1'].version=2;
  for(const state of [{},multiple,newer,data({[cloud]:['one']}),data({[local]:[null]}),data({[local]:[],['local:'+'c'.repeat(64)]:['one']})])
    assert.equal(parseLocalUnread(state).known,false);
});
