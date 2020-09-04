/**
 * local lock, redis lock, db lock
 */
const mongoose = require('mongoose');
const {HUB, db, sdb, second, stat} = require('../db/mongo');
const REDIS = require('../db/redis');
const utils = require('./index');
const redislock = require('redislock');
const LockAcquisitionError = redislock.LockAcquisitionError;
const LockReleaseError = redislock.LockReleaseError;

// (async()=>{
//   await LOCK;
//   let keys = await LOCK.keys('insertaaaaa*');
//   let values = (await LOCK.mget(keys)).map(e=>JSON.parse(e));
//   console.log(keys, values);
// })();
let lockMap = {}, dLockMap = {};
module.exports = {
  lock(id, wait = true) {
    /**
     * const locker = require('../utils/locker');
     * await locker.lock('id'); // wait
     * if (!locker.lock('id')) return; // nowait
     * locker.unlock('id');
     */
    if (lockMap[id]) {
      if (wait) {
        return new Promise(resolve => {
          lockMap[id].push(resolve);
          // console.log(`${id} locked, waiting ${lockMap[id].length}`);
        });
      }
      return false;
    }
    // console.log(`${id} ongoing ${lockMap[id]}`);
    lockMap[id] = [];
    return new Promise(resolve => { resolve(); });
  },
  unlock(id) {
    if (lockMap[id]) {
      let q;
      if (lockMap[id].length === 0) {
        delete lockMap[id];
      } else if ((q = lockMap[id].shift()) != null) {
        // console.log(`${id} resolve`);
        setTimeout(q, 0); // nextTick
      }
      return true;
    }
    // throw new Error('unlock id not found');
  },

  async acquire(id, options = {}) {
    /**
     * const locker = require('../utils/locker');
     *
     * let lock = await locker.acquire('some id', {retries:-1}) // 대기할 경우
     * // do some();
     * lock.release();
     *
     * let lock = await lock.acquire('some id') // 락 실패시 바로 리턴할 경우
     * if (!lock) { return 'locked' };
     * // do some();
     * lock.release();
     *
     * options =  { timeout: 60 * 60 * 1000, retries: 0, delay: 50 }
     *
     * APP 이 재시작 할 때 기존 redis 에 남아있는 lock 을 제거해야 한다.
     * 단독실행이면 문제없으나 동일한 APP_NAME 으로 pm2 cluster 등의 실행일 경우 그 중 하나만 재시작될 때 모두 날라가는 문제가 생긴다.
     * 혹은 개발, 운영, 다른 호스트 등에서 동일한 APP_NAME 일 때 문제가 발생할 수 있다.
     *
     */
    let lock = redislock.createLock(REDIS.lock, Object.assign({}, {timeout:30 * 60 * 1000, ...options}));
    try {
      await lock.acquire(id);
      return lock;
    } catch (e) {
      if (e instanceof LockAcquisitionError) {
        // console.log('LockAcquisitionError');
      } else if (e instanceof LockReleaseError) {
        // console.log('LockReleaseError');
      }
      return false;
    }
  },
  async dLock(id, req) {
    /**
     * distributed lock
     * host, appname 이 포함된 lock 을 걸고, 재시작시 clear 한다.
     *
     * 1. *id 로 조회하여 있는지 확인
     * 2. 없다면 id 로 획득시도
     *   2-1. 획득 실패시 실패 반환 or 대기, 대기시 해당 id 를 sub, sub 을 받으면 1~50까지 랜덤시간 대기 후 재시도
     *   2-2. 획득시 platform|host|port|appname||id 로 setex(1 min) 을 하고 id 를 일정시간(100ms) 이후 제거, 내용에 appname, host, port, session, ip, _dt 포함
     *   2-3. 획득 후 setInterval로 10초 혹은 1분마다 캐시 ex 갱신
     * 3. release 시 platform|host|port|appname||id 를 제거, 해당 id 를 pub
     * 4. app 재시작시 platform|host|port|appname||* 를 제거, 해당 id 들을 pub
     *
     * req 에 lock id 를 넣어두고 종료 혹은 에러처리시 락이 존재한다면 clear
     * lock 획득 실패시 glog 보고 여부
     */
    const {HOST, PORT, APP_NAME} = process.env;
    let _at = new Error().stack.split('\n')[2].replace(/\s+at\s+/, '');
    let {_dt, _uid, _name}  = utils.getSignature(req);
    let ip = req ? req.headers['x-forwarded-for'] || req.connection.remoteAddress : null;
    let key = `${process.platform}|${HOST}|${PORT}|${APP_NAME}||${id}`, locked = false;
    let keys = await REDIS.lock.keys(`*||${id}`);
    if (keys.length === 0) {
      if (await REDIS.lock.setnx(id, '1')) {
        locked = true;
        await REDIS.lock.setex(key, 59, JSON.stringify({HOST, PORT, APP_NAME, ip, _dt, _uid, _name, _at}));
        await REDIS.lock.expire(id, 1);
        setTimeout(async ()=>{await REDIS.lock.del(id);}, 100); // 스스로 req 의 종료를 확인할 수 있는가?
        dLockMap[id] = setInterval(async ()=>{
          // console.log(`interval 3 sec setex ${key}, ${await REDIS.lock.ttl(key)}`);
          await REDIS.lock.expire(key, 59); // 중간에 에러가 나서 del 하지 못할 경우에 대비하여 1분 expire 설정
        }, 55000); // 갱신
        /**
         * req 를 send 하는것 외에 종료시점을 파악할 수 있을지 살펴보았으나 res.send가 일어날 때 timeout 이 5000 으로 변경된다는것 외에는 차이가 없었다.
         * send 이후 timeout 이 지나면 destroy 된다. 그러나 이건 함수의 실행과는 관계없다
         */
        // let i=0, st = setInterval(async ()=>{
        //   console.log(i, req.socket._handle == null, req.socket._readableState.destroyed, req.socket.readable, 'w de', req.socket._writableState.destroyed, req.socket.readable, req.socket.parser == null, req.socket.timeout,
        //     req.connection._handle == null, req.connection._readableState.destroyed, req.connection.readable, 'w de', req.connection._writableState.destroyed, req.connection.readable, req.connection.parser == null, req.connection.timeout,
        //     req.client._handle == null, req.client._readableState.destroyed, req.client.readable, 'w de', req.client._writableState.destroyed, req.client.readable, req.client.parser == null, req.client.timeout);
        //   if (++i > 101) clearInterval(st);
        // }, 100); // 갱신
        req.lock_id = id;
      } else { // 간발의 차이로 락을 획득하지 못했다면
        await utils.sleep(0.05);
        let keys = await REDIS.lock.keys(`*||${id}`);
        let values = (await REDIS.lock.mget(keys)).map(e=>JSON.parse(e));
        let msg = `${values[0]._name} 님이 ${values[0].APP_NAME} 에서 ${values[0]._dt} 부터 작업을 진행중입니다 : ${values[0]._at}`;
        return [false, keys, values, msg];
      }
    } else {
      let values = (await REDIS.lock.mget(keys)).map(e=>JSON.parse(e));
      let msg = `${values[0]._name} 님이 ${values[0].APP_NAME} 에서 ${values[0]._dt} 부터 작업을 진행중입니다 : ${values[0]._at}`;
      return [false, keys, values, msg];
    }
    return [locked];
  },
  async dUnlock(id = '*') {
    const prefix = `${process.platform}|${process.env.HOST}|${process.env.PORT}|${process.env.APP_NAME}||`;
    let keys = await REDIS.lock.keys(`${prefix}${id}`);
    let ids = Array.from(new Set(keys.map(e=>e.replace(prefix, ''))));
    for (let i of ids) {
      // pub i
    }
    if (dLockMap[id]) {
      clearInterval(dLockMap[id]);
      delete dLockMap[id];
      // console.log('clearInterval', id);
    }
    keys.length && await REDIS.lock.del(keys);
  },

  async dbLock(id) {
    await HUB;
    let coll = db.balis.progress_log;
    if (lockMap[id]) {
      let d = await coll.findOne({_id:mongoose.Types.ObjectId(lockMap[id])});
      return [false, lockMap[id], d.progress];
    }
    lockMap[id] = 1;
    let result = await coll.insertOne({id:id, progress:0, done:false});
    let _id = result.insertedId;
    lockMap[id] = _id;
    return [true, _id];
  },
  async dbProg(id, prog) {
    await HUB;
    let coll = db.balis.progress_log;
    coll.updateOne({_id:mongoose.Types.ObjectId(lockMap[id])}, {$set:{progress:prog, done:prog === 100}});
  },
  async dbUnlock(id, done = true) {
    if (lockMap[id]) {
      await HUB;
      let coll = db.balis.progress_log;
      if (done) {
        coll.updateOne({_id: mongoose.Types.ObjectId(lockMap[id])}, {$set: {progress: 100, done: done}});
      } else {
        coll.updateOne({_id: mongoose.Types.ObjectId(lockMap[id])}, {$set: {done: done}});
      }
      delete lockMap[id];
      return true;
    }
    return false;
  }
};

(async()=>{
  await REDIS.lock;
  await module.exports.dUnlock();
})();
