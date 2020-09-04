const axios = require('axios-https-proxy-fix');
const crypto = require('crypto');
const path = require('path');
const {v4:uuid} = require('uuid'); // v1 - time based, v4 - random
const iconvLite = require('iconv-lite');
const moment = require('moment-timezone');
const momentBiz = require('moment-business-days');
const mongoose = require('mongoose');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');
const {HUB_SECONDARY, db, sdb, second, stat} = require('../db/mongo');
const REDIS = require('../db/redis');
const godo_pool = require('../db/godo');
const qry = require('./query');
const socket = require('./socket');
const AWS = require('aws-sdk');
const mime = require('mime-types');
const cron = require('node-cron');
AWS.config.update({"accessKeyId": process.env.AWS_ACCESS_KEY_ID, "secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY});

let utils = module.exports = {
  routerFnMap: {},
  typeOf (obj) {
    return Object.prototype.toString.call(obj).replace('[object ','').replace(']','').toLowerCase();
  },
  split(str, pre, post, idx, include) {
    if (str == null) return;
    let reg = eval("/" + pre + "([\\s\\S]*?)" + post + "/g");
    let arr = str.match(reg);
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = arr[i].replace(reg, "$1");
        if (include) arr[i] = pre + arr[i] + post;
      }
      if (idx != null) {
        arr = arr[idx || 0];
      }
    }
    return arr;
  },
  async sleep(sec) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, sec * 1000);
    });
  },
  euckr (utf8) {
    return iconvLite.encode(Buffer.from(utf8, 'utf8'), 'euc-kr');
  },
  clone (obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  categoryToCode(category) {
    // 009002 등을 받아서 WCL 등을 반환한다.
    if (!category) return 'XXX';
    let gender = {'009':'W', '010':'M'}[category.substring(0, 3)] || 'X';
    let cate = {'002':'CL', '003':'SH', '004':'BA', '005':'AC', '006':'JW'}[category.substring(3, 6)] || 'XX';
    return gender + cate;
  },
  async updateHoliday() {
    /**
     * 최초 접속시 collection 까지 await 을 해도 find() 에서 Promise(Pending) 이 반환되는 경우가 있다.
     * find() 까지 await 을 해 줘야 한다.
     */
    await HUB_SECONDARY;
    let holiday = await (await sdb.external_data.holiday.find()).toArray();

    // 공휴일 설정
    let holidays = holiday.map(e=>{
      if (e.require) return momentBiz().format('YYYY-') + e.date;
      return e.date;
    });
    // 작년, 내년도 추가한다
    holidays = holidays.concat(holiday.filter(e=>e.require).map(e=>momentBiz().add(1, 'year').format('YYYY-') + e.date));
    holidays = holidays.concat(holiday.filter(e=>e.require).map(e=>momentBiz().subtract(1, 'year').format('YYYY-') + e.date));
    momentBiz.updateLocale('kr', {
      holidays: holidays,
      holidayFormat: 'YYYY-MM-DD'
    });
  },
  bizDiff(from, to) {
    if (!to) to = momentBiz().startOf('day');
    return momentBiz(from).startOf('day').businessDiff(momentBiz(to), 'days');
  },
  bizAdd(from, days) {
    return momentBiz(from).businessAdd(days);
  },
  isBizD(d) {
    return momentBiz(d).isBusinessDay();
  },
  dayDiff(from, to) {
    if (!to) to = momentBiz().startOf('day');
    return momentBiz(from).startOf('day').businessDiff(momentBiz(to), 'days');
  },
  kstFormat(obj, format) {
    return moment(obj).tz("Asia/Seoul").format(format);
  },
  kstD(obj, format) {
    return moment(obj, format).tz("Asia/Seoul").format('YYYY-MM-DD');
  },
  kstM(obj, format) {
    return moment(obj, format).tz("Asia/Seoul").format('YYYY-MM');
  },
  kstDT(obj, format) {
    return moment(obj, format).tz("Asia/Seoul").format('YYYY-MM-DD HH:mm:ss');
  },
  randInt(st, ed) {
    return Math.floor(Math.random() * (ed - st + 1)) + st;
  },
  nvl(v, other) {
    return v == null ? other : v;
  },
  ifNull(v, other) {
    return v == null ? other : v;
  },
  ifEmpty(v, other) {
    return v === '' ? other : v;
  },
  // sum(...arr) {
  //   return arr.reduce((a,b) => (this.typeOf(a) === 'array' ? this.sum(...a) : a) + (this.typeOf(b) === 'array' ? this.sum(...b) : b));
  // },
  getTimestamp() {
    let _t = +new Date, _dt = this.kstDT(_t), _d = this.kstD(_t);
    return {_t, _dt, _d};
  },
  getSignature(req) {
    let _t = +new Date, _dt = this.kstDT(_t), _d = this.kstD(_t);
    let _uid, _name;
    if (req) {
      if (req.session && req.session.user) {
        _uid = req.session.user.id;
        _name = req.session.user.name;
      } else { // localhost 라면
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        let isLocal = ip === '::' || ip.endsWith('127.0.0.1'); // ::ffff:127.0.0.1
        if (isLocal && !process.env.IS_PC) {
          _uid = 'localhost';
          _name = 'CRON';
        }
      }
    }
    return {_t, _dt, _d, _uid, _name};
  },
  objId(id) {
    return mongoose.Types.ObjectId(id);
  },
  getUA() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.97 Safari/537.36';
  },

  async getDB() {
    // console.log(`PID[${process.pid}] CONNECTION ${godo_pool._allConnections.length}`);
    // this.glog('godoConn', godo_pool._allConnections.length, '고도몰 커넥션 수', {params:[new Error().stack.split('\n')[2].trim()]});
    return await new Promise((resolve, reject) => {
      godo_pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });
  },
  async tx(conn, func, errFunc, finFunc) {
    let result;
    let query = async (...params) => qry.queryWithConn(conn, ...params);
    try {
      await new Promise(resolve => conn.beginTransaction(resolve));
      if (typeof(func) === 'string') { // func 를 쿼리문, errFunc 를 params 로 간주한다.
        result = await query(func, errFunc);
      } else {
        result = await func(query);
      }
      await new Promise(resolve => conn.commit(resolve));
    } catch (e) {
      await new Promise(resolve => conn.rollback(resolve));
      errFunc && await errFunc(query);
      throw e;
    } finally {
      finFunc && await finFunc(query);
      conn.release();
    }
    return result;
  },
  async godoTx(func, errFunc, finFunc) {
    let conn = await this.getDB();
    return await this.tx(conn, func, errFunc, finFunc);
  },
  async godoQuery(func, errFunc, finFunc, finFunc2) {
    let conn = await this.getDB(), result;
    let query = async (...params) => qry.queryWithConn(conn, ...params);
    try {
      if (typeof(func) === 'string') { // func 를 쿼리문, errFunc 를 params 로 간주한다.
        result = await query(func, errFunc);
      } else {
        result = await func(query);
      }
    } catch (e) {
      if (typeof(func) === 'string') finFunc && await finFunc(query);
      else errFunc && await errFunc(query);
      throw e;
    } finally {
      if (typeof(func) === 'string') finFunc2 && await finFunc2(query);
      finFunc && await finFunc(query);
      conn.release();
    }
    return result;
  },
  async godoRow(query, params, errFunc, finFunc) {
    /** 쿼리의 첫 번째 row 혹은 null 을 반환한다. */
    let rows = await this.godoQuery(query, params, errFunc, finFunc);
    return rows.length ? rows[0] : null;
  },
  async godoOne(query, params, errFunc, finFunc) {
    /** 쿼리의 첫 번째 row의 첫 번째 값 혹은 null 을 반환한다. */
    let rows = await this.godoQuery(query, params, errFunc, finFunc);
    return rows.length ? Object.values(rows[0])[0] : null;
  },
  async es(url, body) {
    const ES_URL = (process.env.IS_DEV) ? 'http://dev.balaan.io:9201' : 'http://es-prod-godo.balaan.io';
    try {
      if (body) {
        if (this.typeOf(body) === 'string') {
          return (await axios.put(ES_URL + url, body, {headers:{"Content-type": "application/json"}})).data;
        } else { // object, array, ...
          return (await axios.post(ES_URL + url, body)).data;
        }
      } else {
        return (await axios.get(ES_URL + url)).data;
      }
    } catch (e) {
      // console.error(e);
      return e.response && e.response.data || e.message;
    }
  },

  async prog(group, query = null) {
    /**
     * 오래 걸리는 작업에 대해 작업 진행의 평균값을 측정하여 진행시간을 예측한다.
     * socket 으로 진행상황을 전달한다.
     const P = utils.prog('some job', 'sd=20200101&ed=20200301');
     P.lap('fetch')
     P.lap('send')
     P.done()
     */
    const io = socket.getIO();
    let st = +new Date, _st = +new Date, idx = 0; // 최초 시작, 중간 job 시작, 작업순번
    let id = uuid().slice(-12);
    // 기존 작업을 가져와서 전체 시간을 예측한다.
    let docs = await stat.stat.prog_done.find({group, query}, {projection:{stat:1}}).sort({_t:-1}).limit(1).toArray();
    let stats = {sum:0, avg:0, min:Number.MAX_SAFE_INTEGER, max:0, cnt:0};
    if (docs[0]) stats = docs[0].stat;
    let predict = stats.avg;
    let nextJob = await stat.stat.prog.find({group, query, idx:0}, {projection:{job:1, elapsed:1, stat:1}}).sort({_t:-1}).limit(1).toArray();
    io.emit(`prog`, {type:'start', group, query, id, predict, stat: stats, next:nextJob[0]});
    return {
      id,
      group,
      async lap(job) {
        let {_t, _dt} = utils.getTimestamp();
        let elapsed = (_t - _st) / 1000, total_elapsed = (_t - st) / 1000;
        // 기존 작업을 가져와서 sum avg min max cnt 를 계승한다.
        let docs = await stat.stat.prog.find({group, query, job}, {projection:{stat:1}}).sort({_t:-1}).limit(1).toArray();
        let stats = {sum:0, avg:0, min:Number.MAX_SAFE_INTEGER, max:0, cnt:0};
        if (docs[0]) stats = docs[0].stat;
        stats.sum += elapsed; stats.cnt++; stats.avg = stats.sum / stats.cnt; stats.min = Math.min(stats.min, elapsed); stats.max = Math.max(stats.max, elapsed);
        stat.stat.prog.insertOne({group, query, id, job, idx, elapsed, total_elapsed, stat: stats, _t, _dt});
        _st = _t;
        idx++;

        // 현재까지 소요시간과 다음 job 별 예상시간을 보내서 progress 를 증가시키게 한다.
        let nextJob = await stat.stat.prog.find({group, query, idx}, {projection:{job:1, elapsed:1, stat:1}}).sort({_t:-1}).limit(1).toArray();
        io.emit(`prog`, {type:'lap', group, query, id, job, elapsed, total_elapsed, predict, next:nextJob[0]});
      },
      async done() {
        // 전체 소요시간에 대해서 시기별로 통계를 저장한다.
        let {_t, _dt} = utils.getTimestamp();
        let elapsed = (_t - st) / 1000;
        // 기존 작업을 가져와서 sum avg min max cnt 를 계승한다.
        let docs = await stat.stat.prog_done.find({group, query}, {projection:{stat:1}}).sort({_t:-1}).limit(1).toArray();
        let stats = {sum:0, avg:0, min:Number.MAX_SAFE_INTEGER, max:0, cnt:0};
        if (docs[0]) stats = docs[0].stat;
        stats.sum += elapsed; stats.cnt++; stats.avg = stats.sum / stats.cnt; stats.min = Math.min(stats.min, elapsed); stats.max = Math.max(stats.max, elapsed);
        stat.stat.prog_done.insertOne({group, query, id, idx, elapsed, stat: stats, _t, _dt});
        io.emit(`prog`, {type:'done', group, query, id, elapsed, stat: stats});
      }
    };
  },

  async child(prefix = [], func, data, output = true) {
    /**
     * 예를 들어 xlsx 생성의 경우 cpu 소모가 커서 node 에서 실행할 경우 다른 작업들이 stuck 된다.
     * 그러나 process를 새로 생성할 경우 기존 DB 커넥션 등을 사용할 수 없다.
     * 이런 작업들을 최소의 리소스를 포함시켜 js 로 만든 뒤 child process 로 진행한다.
     * 1. 함수를 string 화 한 뒤 형태를 만들어 임시 js 파일에 저장한다. 위치는 node_modules 를 쓸 수 있도록 app root 에 둔다.
     * 2. 필요 input 데이터를 json 파일로 저장하고(array 형태), 필요한 require 를 포함하여 임시 js 파일을 만든다. main 파일이 자동으로 실행되게 하며 결과를 저장하게 한다.
     * 3. 결과 파일을 읽어온 뒤 지우고 input json, 임시 js 파일을 지운다.
     *
     * 함수는 toString 을 할 경우 아래와 같이 다양한 형태가 가능할 수 있다.
     * async()=>{}
     * async function(){}
     * async function child(prefix) {}
     * async qq(){}
     * 일괄적으로 ( 전까지를 날라고 const func = async 를 앞에 붙인다. () 와 {} 사이에 => 를 넣는다. 'const func = async' + 'async()=>{(1)}'.replace(/^.*?\(/, '(').replace(/\)[\s\S]*?\{/, ')=>{')
     */
    const read = promisify(fs.readFile), write = promisify(fs.writeFile), unlink = promisify(fs.unlink);
    let id = '__child_' + uuid().replace(/-/g, '');
    await write(path.join(process.env.ROOT, `${id}.json`), JSON.stringify(data));
    let f = 'const func = async' + func.toString().replace(/^.*?\(/, '(').replace(/\)[\s\S]*?\{/, ')=>{');
    let js = `const fs = require('fs');\n${prefix.join('\n')}\n${f};

    (async()=>{
      let args = JSON.parse(fs.readFileSync('${id}.json', 'utf8'));
      let result = await func(...args);
      ${output ? `fs.writeFileSync('${id}.output.json', result);` : ''}
      // process.exit(0);
      console.log('end');
    })();
    `;
    await write(path.join(process.env.ROOT, `${id}.js`), js);
    let r = await promisify(exec)(`cd ${process.env.ROOT} && node --max-old-space-size=16000 ${id}.js`);
    if (r.stderr) console.error(r.stderr);
    let result;
    await unlink(path.join(process.env.ROOT, `${id}.json`));
    await unlink(path.join(process.env.ROOT, `${id}.js`));
    if (output) {
      result = await read(path.join(process.env.ROOT, `${id}.output.json`), 'utf8');
      await unlink(path.join(process.env.ROOT, `${id}.output.json`));
    }
    return result;
  },

  setDiff(a, b, {rule, projection, signature, history, sliceDiff, sliceHistory} = {}) {
    /**
     * signature 는 _name, _id 등 변경자의 정보이다
     * 공통 플래그로 _t, _dt 를 쓸 경우에 대비해서 signature에 _t, _dt 가 있다면 변경하지 않고 사용한다.
     * {$set:b, $push: {_diff: {$each: [_diff]}}} 형태를 반환한다.
     */
    let {_t = +new Date, _dt = this.kstDT(_t), _uid, _name, _at} = signature || {};
    Object.assign(b, {_t, _dt});
    if (!a) { // 기존 값이 없는 경우
      b._cdt = _dt;
      if (_uid) b._cuid = _uid;
      if (_name) b._cname = _name;
      if (_at) b._cat = _at;
      return {$set:b};
    }

    if (projection == null) { // b 에 있는 key 만 대상으로 한다
      projection = {};
      Object.keys(b).forEach(k=>projection[k] = 1);
    } else if (projection === false) { // DB의 모든 key를 대상으로 한다.
      projection = {};
    }
    delete b._diff;
    delete b._diff_history;
    projection = projection || {};
    let updateDoc = {$set:b, $push: {}};
    let projectionHasTrue = Object.values(projection).some(v=>v); // 1, true 등이 하나라도 있다면 projection 에 표시되지 않은 다른 값들은 0 이다

    let _diff = this.deepDiff.map(a, b, rule, projection) || {}, unset;
    if (Object.keys(_diff).length > 0) { // 차이가 있을 때
      Object.assign(_diff, {_t, _bef_dt: a._dt, _dt, ...(signature || {})});

      let newKeys = Object.keys(b);
      let oldKeys = Object.keys(a).filter(k=>!~newKeys.indexOf(k) && k[0] !== '_' && (projection[k] || !projectionHasTrue && projection[k] == null)); // 삭제대상 키를 찾는다. _ 로 시작하는 것은 제외한다.
      if (oldKeys.length) {
        unset = {};
        oldKeys.forEach(k=>unset[k]=1);
        updateDoc.$unset = unset;
      }

      updateDoc.$push._diff = {$each: [_diff]};
      if (!sliceDiff) sliceDiff = 100;
      updateDoc.$push._diff.$slice = -sliceDiff;
    }
    if (history) {
      updateDoc.$push._diff_history = {$each: [_dt]};
      if (!sliceHistory) sliceHistory = 100;
      updateDoc.$push._diff_history.$slice = -sliceHistory;
    }
    if (!Object.keys(updateDoc.$push).length) { // 차이가 없을 경우 b._t, b._dt 만 update 된다
      delete updateDoc.$push;
    }
    return updateDoc;
  },
  async updateDiff(newObj, coll, id, {rule, projection, signature, history, sliceDiff, sliceHistory} = {}) {
    /**
     * coll에서 id로 찾은 값과 newObj 를 비교하여 coll에 바로 업데이트한다.
     * history: T/F, _diff_history 에 변화가 없어도 시간을 기록할지의 여부
     * sliceDiff: _diff 를 최근의 몇 개만 남겨둘지
     * sliceHistory: diff_history 를 최근의 몇 개만 남겨둘지
     */
    let q = {};
    if (typeof(id) === 'string') {
      id = id.split(',');
      id.forEach(k=>{
        let v = k.split('.').reduce((e,a)=>e == null ? null : e[a], newObj);
        q[k] = v;
      });
    } else {
      q = id;
    }
    if (projection == null) { // newObj 에 있는 key 만 대상으로 한다
      projection = {};
      Object.keys(newObj).forEach(k=>projection[k] = 1);
    } else if (projection === false) { // DB의 모든 key를 대상으로 한다.
      projection = {};
    }
    let proj = {_id:0, ...projection};
    let projectionHasTrue = projection && Object.values(projection).some(v=>v); // 1, true 등이 하나라도 있다면 projection 에 표시되지 않은 다른 값들은 0 이다
    if (projectionHasTrue) {
      proj._dt = 1; // _bef_dt 를 만들기 위해 필요하다
    } else {
      Object.assign(proj, {_diff:0, _diff_history:0, _t:0});
    }
    let oldObj = await coll.findOne(q, {projection:proj});
    let updateDoc = this.setDiff(oldObj, newObj, {rule, projection, signature, history, sliceDiff, sliceHistory});
    try {
      if (updateDoc) await coll.updateOne(q, updateDoc, {upsert:true});
    } catch (e) {
      console.error('err in updateDiff', updateDoc, e);
    }
    return updateDoc;
  },
  async updateDiffBulk(newArr, coll, id, {rule, projection, signature, history, sliceDiff, sliceHistory} = {}) {
    /**
     * 한 건씩 updateDiff 를 하면 느리기에 한 번에 찾아오고, 비교 후 한 번에 bulkWrite 한다.
     * id 는 a,b 등으로 콤마로 구분하여 여러 개를 넣을 수 있다
     */
    let projAll = {};
    if (projection == null) { // newObj 에 있는 key 만 대상으로 한다
      for (let n of newArr) {
        Object.keys(n).forEach(k=>projAll[k] = 1);
      }
    } else if (projection === false) { // DB의 모든 key를 대상으로 한다.
    } else if (utils.typeOf(projection) === 'object') {
      Object.assign(projAll, projection);
    }

    let projectionHasTrue = projAll && Object.values(projAll).every(v=>v); // 1, true 등이 하나라도 있다면 projection 에 표시되지 않은 다른 값들은 0 이다
    if (projectionHasTrue) {
      projAll._dt = 1; // _bef_dt 를 만들기 위해 필요하다
    } else {
      Object.assign(projAll, {_diff:0, _diff_history:0, _t:0});
    }
    projAll._id = 0;

    let q = {};
    id = id.split(',');
    id.forEach(k=>q[k] = {$in:[]});
    newArr.forEach(e=>{
      e._key = id.map(k=>{
        let v = k.split('.').reduce((e,a)=>e == null ? null : e[a], e);
        q[k].$in.push(v);
        return v;
      }).join('|');
    });
    let oldMap = await this.makeMap(coll, q, id.join(','), projAll);

    let bulk = [];
    for (let newObj of newArr) {
      let oldObj = oldMap[newObj._key];
      delete newObj._key;
      let updateDoc = this.setDiff(oldObj, newObj, {rule, projection, signature, history, sliceDiff, sliceHistory});
      try {
        let q = {};
        id.forEach(k=>{
          let v = k.split('.').reduce((e,a)=>e == null ? null : e[a], newObj);
          q[k] = v;
        });
        bulk.push({updateOne: {filter: q, update: updateDoc, upsert: true}});
      } catch (e) {
        console.error('err in updateDiffBulk', updateDoc, e);
      }
    }
    bulk.length && await coll.bulkWrite(bulk);
  },

  async innerJoin(collA, collB, join, qA={}, qB={}, {projA = {_id: 0}, projB = {_id: 0}, sortA={_id:-1}, sortB={_id:-1}, limit=100, skip=0, includeDiff=false} = {}) {
    /**
     * 미완성
     *
     * collA와 collB를 점진적 조인한다.
     * join 의 형식은 {keyOfA:keyOfB} 이다.
     * 데이터의 join 가능성이 낮을수록 여러번 join 하기에 성능이 좋지 않다.
     * collA 를 driven으로 놓고 limit을 피보나치로 증가시킨다.
     * 기존 내부 limit, skip에 대해 cache 해둘 필요가 있다.
     * projA 는 'a,b,c', ['a','b'], {a:1, b:'a', c:true}, false 등의 형태를 지원한다.
     * projA 가 false 라면 doc의 전체 데이터, true 라면 존재 유무만 판단한다.
     */
    projA = !includeDiff && !projA ? {_id: 0, _diff: 0, _diff_history: 0} : {_id: 0};
    projB = !includeDiff && !projB ? {_id: 0, _diff: 0, _diff_history: 0} : {_id: 0};
    let fib = [1,2];
    let rows = [];

    let a = await collA.find(qA, {projection:projA}).sort(sortA).limit(limit * fib.slice(-1)[0]).toArray();
    let qB_ = this.clone(qB), keyA = [], keyB = [];
    // join 에서 qA에 있는 값은 그대로, 없는 값은 a 에서 가져와서 $in으로 처리
    Object.entries(join).forEach(([k,v])=>{
      keyA.push(k); keyB.push(v);
      if (qA[k] !== undefined) qB_[v] = qA[k];
      else qB_[v] = {$in:a.map(e=>e[k])};
    });
    let b = await collB.find(qB_, {projection:projB}).sort(sortB).limit(limit * fib.slice(-1)[0]).toArray();

    // b 에 없는 a 는 삭제
    let abMap = {};
    b.forEach(e=>{
      let v = abMap[keyB.map(k=>e[k]).join('|')] = (abMap[keyB.map(k=>e[k]).join('|')] || []);
      v.push(e);
    });
    a = a.filter(e=>{
      let listB = abMap[keyA.map(k=>e[k]).join('|')];
      if (listB) e._listB = listB; // key 를 기준으로 1:n join
      return listB;
    });

    if (a.length < limit) console.log(a.length);
    return a;
  },

  async makeMap(coll, q, key, fields = false, {includeDiff=false, keySeperator='|'} = {}) {
    /**
     * key 는 map 의 key가 되는 부분이다.
     * key는 a.b 로 object access 가 가능하며 a.b,a.c 로 pair를 이루는 것도 가능하다.
     * fields 는 'a,b,c', ['a','b'], {a:1, b:'a', c:true}, false 등의 형태를 지원한다.
     * fields 가 false 라면 doc의 전체 데이터, true 라면 존재 유무만 판단한다.
     */
    let projection = !includeDiff && !fields ? {_id:0, _diff:0, _diff_history:0} : {_id:0};
    if (key == null) key = Object.keys(q)[0];
    key = key.split(',');
    if (fields) {
      key.forEach(k=>projection[k] = 1);
      if (typeof(fields) === 'string') {
        fields = fields.split(',');
        fields.forEach(k=>projection[k]=1);
      } else if (fields === true) {
        // key의 존재여부만 확인하기 위해 true 를 넣는다.
      } else if (this.typeOf(fields) === 'object') {
        Object.keys(fields).forEach(e=>projection[e] = 1);
      } else if (this.typeOf(fields) === 'array') {
        fields.forEach(e=>projection[e] = 1);
      }
    }
    let data = await coll.find(q, {projection}).toArray();
    let map = {};
    data.forEach(e=>{
      let k = key.map(k=>{
        return k.split('.').reduce((e,a)=>e[a], e);
      }).join(keySeperator);
      map[k] = fields === true ? true : (fields && fields.length === 1 ? e[fields[0]] : e);
    });
    return map;
  },
  async makeMultiMap(coll, q, key, fields = false, {includeDiff=false, keySeperator='|'} = {}) {
    /**
     * key 는 map 의 key가 되는 부분이다.
     * key는 a.b 로 object access 가 가능하며 a.b,a.c 로 pair를 이루는 것도 가능하다.
     * key 에 해당하는 객체가 2개 이상일 수 있는 데이터를 가졍하며
     * {[key]:[value1, value2]} 형태를 반환한다.
     * fields 는 'a,b,c', ['a','b'], {a:1, b:'a', c:true}, false 등의 형태를 지원한다.
     * fields 가 false 라면 doc의 전체 데이터를 넣는다.
     */
    let projection = !includeDiff && !fields ? {_id:0, _diff:0, _diff_history:0} : {_id:0};
    if (key == null) key = Object.keys(q)[0];
    key = key.split(',');
    if (fields) {
      key.forEach(k=>projection[k] = 1);
      if (typeof(fields) === 'string') {
        fields = fields.split(',');
        fields.forEach(k=>projection[k]=1);
      } else if (this.typeOf(fields) === 'object') {
        Object.keys(fields).forEach(e=>projection[e] = 1);
      } else if (this.typeOf(fields) === 'array') {
        fields.forEach(e=>projection[e] = 1);
      }
    }
    let data = await coll.find(q, {projection}).toArray();
    let map = {};
    data.forEach(e=>{
      let k = key.map(k=>{
        return k.split('.').reduce((e,a)=>e[a], e);
      }).join(keySeperator);
      let v = map[k] = map[k] || [];
      v.push(fields && fields.length === 1 ? e[fields[0]] : e);
    });
    return map;
  },
  arr2map(arr, key, fields = false, {keySeperator='|'} = {}) {
    /**
     * arr 를 특정 key 를 기준으로 map 화 한다.
     * key는 a.b 로 object access 가 가능하며 a.b,a.c 로 pair를 이루는 것도 가능하다.
     * fields 는 'a,b,c', ['a','b'], {a:1, b:'a', c:true}, false 등의 형태를 지원한다.
     * fields 가 false 라면 doc의 전체 데이터를 넣는다.
     *
     * arr2map([{a:{b:1,c:2}}], 'a.b,a.c')
     => {1|2: {a: {…}}
     */
    let map = {}, projection;
    if (typeof(fields) === 'string') {
      projection = fields.split(',');
    } else if (this.typeOf(fields) === 'object') {
      projection = Object.keys(fields);
    } else if (this.typeOf(fields) === 'array') {
      projection = fields;
    }
    key = key.split(',');
    arr.forEach(e=>{
      let k = key.map(k=>{
        return k.split('.').reduce((e,a)=>e[a], e);
      }).join(keySeperator);
      if (fields === true) { // key의 존재여부만 확인하기 위해 true 를 넣는다.
        map[k] = true;
      } else if (fields === false) { // 모든 값
        map[k] = e;
      } else {
        let obj = {};
        projection.forEach(k=>obj[k] = e[k]);
        map[k] = obj;
      }
      map[k] = fields === true ? true : (fields && projection.length === 1 ? e[projection[0]] : e);
    });
    return map;
  },
  arr2multi(arr, key, fields = false, {keySeperator='|'} = {}) {
    /**
     * arr 를 특정 key 를 기준으로 map 화 한다.
     * key는 a.b 로 object access 가 가능하며 a.b,a.c 로 pair를 이루는 것도 가능하다.
     * fields 는 'a,b,c', ['a','b'], {a:1, b:'a', c:true}, false 등의 형태를 지원한다.
     * fields 가 false 라면 doc의 전체 데이터를 넣는다.
     * map의 value는 [arr[0], ..] 이다.
     */
    let map = {}, projection;
    if (typeof(fields) === 'string') {
      projection = fields.split(',');
    } else if (this.typeOf(fields) === 'object') {
      projection = Object.keys(fields);
    } else if (this.typeOf(fields) === 'array') {
      projection = fields;
    }
    key = key.split(',');
    arr.forEach(e=>{
      let k = key.map(k=>{
        return k.split('.').reduce((e,a)=>e[a], e);
      }).join(keySeperator);
      let v = map[k] = map[k] || [];
      v.push(fields && projection.length === 1 ? e[projection[0]] : e);
    });
    return map;
  },
  set(arr, key) {
    if (key) arr = arr.map(e=>e[key]);
    return Array.from(new Set(arr));
  },

  checkRole(role) {
    /**
     *  권한 체크 미들웨어, role 이 array 라면 그 중 하나라도 일치하면 통과시킨다
     *  role 이 '' 이라면 로그인만 체크하는 용도로 사용된다.
     */
    return (req, res, next) => {
      let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      let isLocal = ip.startsWith('::') || ip.endsWith('127.0.0.1'); // ::, ::1, ::ffff:127.0.0.1
      // console.log('isLocal', isLocal, ip);
      // if (req.session && req.session.user || (isLocal)) {
      if (req.session && req.session.user || (!process.env.IS_PC && isLocal)) { // PC 에서는 로그인 체크가 필요하다
        if (isLocal || (role === ''
          || ~req.session.user.roles.indexOf(role)
          || utils.typeOf(role) === 'array' && role.some(e=>~req.session.user.roles.indexOf(e)) ))
          return next();
        else
          res.status(403).json({ok:0, msg: `[${req.url}, ${role}]: 해당 기능을 실행할 권한이 없습니다`});
      } else {
        res.status(401).json({ok:0, msg: `로그인이 필요합니다`});
      }
    }
  },
  hasRole(req, role) {
    /** 세션을 검사해서 권한이 있는지 확인한다. */
    return req.session && req.session.user && (~req.session.user.roles.indexOf(role) || utils.typeOf(role) === 'array' && role.some(e=>~req.session.user.roles.indexOf(e)));
  },

  setT(group) {
    return (req, res, next) => {
      let locale = req.session && req.session.user && req.session.user.locale || req.cookies.locale || 'en-US';
      req.T = getT(locale, group);
      next();
    }
  },
  adapter (router, method, ...args) {
    const locker = require('./locker');
    let url = args[0], middlewares = args.slice(1, args.length - 1), routerFn = args[args.length - 1];
    const fnWithCatch = (req, res, next) => {
      let locale = req.session && req.session.user && req.session.user.locale || req.cookies.locale || 'en-US';
      req.locale = locale;
      routerFn(req, res, next).then(()=>{
        if (req.lock_id) locker.dUnlock(req.lock_id); // lock 이 있다면 release
      }).catch(e=>{
        if (req.lock_id) locker.dUnlock(req.lock_id); // lock 이 있다면 release
        console.error(e);
        res.status(500).json({ok:0, msg:e.message});
      });
    };
    if (typeof(url) === 'string') url = [url];
    url.forEach(u=>{
      if (~method.toLowerCase().indexOf('get')) {
        router.get(u, ...middlewares, fnWithCatch);
        this.routerFnMap['get '+u] = routerFn;
      }
      if (~method.toLowerCase().indexOf('post')) {
        router.post(u, ...middlewares, fnWithCatch);
        this.routerFnMap['post '+u] = routerFn;
      }
    });
  },
  router (router) {
    return {
      get: (...args) => this.adapter(router, 'get', ...args),
      post: (...args) => this.adapter(router, 'post', ...args),
      get_post: (...args) => this.adapter(router, 'get,post', ...args),
    }
  },

  async toS3(bucket, s3FileName, data, type) {
    if (!type) type = mime.lookup(s3FileName) || 'application/octet-stream';
    return new Promise((resolve, reject)=>{
      new AWS.S3().upload({Bucket: bucket, Key: s3FileName, Body: data, StorageClass:'INTELLIGENT_TIERING', ContentType: type}, function(err, data) {
        if (err) {
          console.log(err, err.stack);
          reject(err);
        } // an error occurred
        // console.log(data);
        resolve();
      });
    });
  },
  async uploadMultipart(bucketName, s3FileName, absoluteFilePath, type) {
    if (!type) type = mime.lookup(s3FileName) || 'application/octet-stream';
    let parts = [], uploadId, s3 = new AWS.S3();
    await new Promise((resolve, reject) => {
      s3.createMultipartUpload({Bucket: bucketName, Key: s3FileName, StorageClass:'INTELLIGENT_TIERING', ContentType: type}, (mpErr, multipart) => {
        uploadId = multipart.UploadId;
        if (!mpErr) {
          let stat = fs.statSync(absoluteFilePath);
          let partSize = 1024 * 1024 * 10;
          let partNum = 0, maxPartNum = Math.ceil(stat.size / partSize);
          let rs = fs.createReadStream(absoluteFilePath, {highWaterMark: partSize});
          let closed = false;
          rs.on('data', function (chunk) {
            partNum++;
            rs.pause();
            s3.uploadPart({
              Body: chunk,
              Bucket: bucketName,
              Key: s3FileName,
              PartNumber: partNum,
              UploadId: multipart.UploadId
            }, (err, mData) => {
              if (err) {
                reject(err);
                rs.close();
              } else {
                // console.log({ETag: mData.ETag, PartNumber: partNum});
                parts.push({ETag: mData.ETag, PartNumber: partNum});
                if (closed || partNum === maxPartNum) {
                  // console.log('data closed');
                  resolve(mData);
                } else {
                  rs.resume();
                  // console.log('resume');
                }
              }
            });
          });
          rs.on('close', function () {
            // console.log('closed');
            closed = true;
          });
          rs.on('error', function (err) {
            console.log(err);
            reject(err);
          });
        } else {
          reject(mpErr);
        }
      });
    });
    await new Promise((resolve, reject) => {
      s3.completeMultipartUpload({
        Bucket: bucketName,
        Key: s3FileName,
        MultipartUpload: {
          Parts: parts
        },
        UploadId: uploadId
      }, (err, data) => {
        // console.log('complete', data);
        if (err) reject(err);
        else resolve(data);
      });
    });
  },
  async delS3(bucket, filename) {
    /**
     * Key 는 / 로 시작하면 안된다는 것에 주의!
     * Key = 'goods/prod/...'
     */
    let s3 = new AWS.S3(), toKey = k => k.replace(/^https?:\/\/.*?\//, ''), deleteObject = async (params) => {
      return new Promise((resolve, reject) => {
        s3.deleteObject(params, (err, data) => {
          if (err) return reject(err);
          resolve(data);
        })
      });
    };
    if (typeof filename === 'string') {
      let params = {Bucket: bucket, Key: toKey(filename)};
      let done = await deleteObject(params);
    } else {
      for (let Key of filename.map(e=>toKey(e))) {
        let params = {Bucket: bucket, Key};
        let done = await deleteObject(params); // {}
        // console.log(Key, done);
      }
      /*
        아래 방식은 삭제가 잘 되지 않는다.
        https://stackoverflow.com/questions/30387947/amazon-s3-node-js-sdk-deleteobjects
       */
      // let params = {Bucket: bucket, Delete: {Objects: filename.map(e=>({Key:e}))}};
      // s3.deleteObjects(params, (err, data) => {
      //   if (err) return reject(err);
      //   resolve(data);
      // });
    }
  },

  async invalidateCF(items) {
    /**
     * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html#PayingForInvalidation
     * A path that includes the * wildcard counts as one path even if it causes CloudFront to invalidate thousands of files.
     * 무효화 경로에 * 가 있어도 하나로 쳐주기에 비용을 절약하려면 항상 합치도록 한다.
     * 여기의 Items 는 Key 와는 달리 / 를 붙이지 않으면 InvalidArgument: Your request contains one or more invalid invalidation paths. 에러가 발생한다.
     * /goods/prod/202004/348/3484459-*
     */
    if (items.length === 0) return;
    let lcs = '', toKey = k => k.replace(/^https?:\/\/.*?\//, '/');
    items = items.map(e=>toKey(e));
    for (let i=0; i<items[0].length; i++) {
      if (new Set(items.map(e=>e[i])).size > 1) {
        lcs = items[0].substring(0, i);
        break;
      }
    }
    if (lcs !== '') {
      items = [lcs + '*'];
    }
    const cloudfront = new AWS.CloudFront();
    await cloudfront.createInvalidation({
      DistributionId: 'E2TQGZEKXH7K36',
      InvalidationBatch: {
        CallerReference: `IMAGE-PROCESS-${+new Date}`,
        Paths: {
          Quantity: items.length,
          Items: items,
        },
      },
    }).promise();
  },


  async getResCache(req, {keys, threshold}) {
    /**
     * 캐시된 값을 반환한다.
     * get method 의 req.query 에 대해 cache 를 분기하며, 적용될 key 들은 keys 로 지정한다. 모든 key 에 대해서라면 keys = null 로 설정한다.
     * redis의 ttl이 threshold 이하로 남은 경우 갱신을 진행해야 하고, needRenew 가 true가 된다.
     */
    if (keys === null) { // 명시적으로 null이 들어오면 모든 키에 대해 캐시를 분기한다
      keys = Array.from(new Set(Object.keys(req.query).concat(Object.keys(req.params)).concat(Object.keys(req.body))));
    }
    let key = req.baseUrl + req._parsedUrl.pathname + '>>>' + (keys || []).map(k=>{
      let v = this.ifNull(req.query[k], this.ifNull( req.params[k], this.ifNull(req.body[k], '')));
      if (typeof(v) === 'object') v = JSON.stringify(v);
      return `${k}:${v}`;
    }).join('|');
    let v = await REDIS.cache.get(key);
    if (v) {
      v = JSON.parse(v);
      let ttl = await REDIS.cache.ttl(key);
      if (threshold && ttl <= threshold) return [v, true]; // 갱신이 필요할 때
      return [v, false];
    }
    return [null, true]; // cached, needRenew
  },
  async setResCache(req, {keys, ttl}, obj) {
    /**
     * 결과값을 세팅하고 ttl을 지정한다.
     * get method 의 req.query 에 대해 cache 를 분기하며, 적용될 key 들은 keys 로 지정한다. 모든 key 에 대해서라면 keys = null 로 설정한다.
     * 이를 통해 결과를 저장할 redis key 를 지정한다.
     */
    if (keys === null) { // 명시적으로 null이 들어오면 모든 키에 대해 캐시를 분기한다
      keys = Array.from(new Set(Object.keys(req.query).concat(Object.keys(req.params)).concat(Object.keys(req.body))));
    }
    let key = req.baseUrl + req._parsedUrl.pathname + '>>>' + (keys || []).map(k=>{
      let v = this.ifNull(req.query[k], this.ifNull( req.params[k], this.ifNull(req.body[k], '')));
      if (typeof(v) === 'object') v = JSON.stringify(v);
      return `${k}:${v}`;
    }).join('|');
    await REDIS.cache.setex(key, ttl, JSON.stringify(obj));
  },
  async processCache(req, res, keys, ttl, threshold, single = true) {
    /**
     * request 의 결과에 대해 ttl 만큼 cache 를 유지하며, threshold 가 지나면 갱신한다.
     * get method 의 req.query 에 대해 cache 를 분기하며, 적용될 key 들은 keys 로 지정한다. 모든 key 에 대해서라면 keys = null 로 설정한다.
     * single 이 true 라면 동시에 하나의 요청만 접근하게 한다.
     * ResCacheHit(캐시에서 가져왔는지) 과 ResCacheRenew(캐시를 누군가가 갱신하는지) ResCacheRenewNow(캐시 갱신을 현재 리퀘스트가 진행중인지) 헤더를 설정한다.
     */
    let [cached, needRenew] = await this.getResCache(req, {keys, threshold});
    let sent = cached != null;
    res.set('ResCacheHit', sent ? 1 : 0);
    res.set('ResCacheRenew', needRenew ? 1 : 0);
    if (sent) {
      if (single && needRenew) { // 요청을 처리하는데 부하가 크다면 필요시 이중 접근 금지
        if (await REDIS.cache.setnx('hub_setnx_' + req.baseUrl + req._parsedUrl.pathname, 'locked')) { // 이 request 에서 renew를 진행할지에 대한 판단을 위해 lock을 사용
          res.set('ResCacheRenewNow', 1);
          await REDIS.cache.expire('hub_setnx_' + req.baseUrl + req._parsedUrl.pathname, 60); // 중간에 에러가 나서 del 하지 못할 경우에 대비하여 1분 expire 설정
        } else { // 락을 획득하지 못했다면 이 request 는 renew 를 진행하지 않는다
          needRenew = false;
        }
      }
      res.json(cached);
    }
    return [sent, needRenew];
  },
  async processCacheAfter(req, res, keys, ttl, sent, resJson) {
    /**
     * processCache 를 사용했다면, 캐시되지 않았을 경우 결과를 set 하기 위해 통합적으로 후처리를 진행하다.
     */
    await this.setResCache(req, {keys, ttl}, resJson);
    if (!sent) res.json(resJson);
    else await REDIS.cache.del('hub_setnx_' + req.baseUrl + req._parsedUrl.pathname);
  },
  autoRenew(url, exp) {
    /**
     * 자신의 URL 을 지정된 cron 마다 호출한다. 주로 lazy cache 와 같이 쓰인다.
     * middleware 로 생각했으나 할당된 url을 가져올 수 없어서 별도로 사용해야 한다.
     * cron과 동일하게 하나에서만 실행되도록 한다. 시작시점에 process.env.PM2_FIRST_PROCESS 가 적용되지 않을 수 있으므로 매 실행시점에 체크한다.
     */
    // if (process.env.PORT === process.env.HUB_PORT) { // hub 에서 실행될 때
    if (!process.env.IS_PC && process.env.PORT === process.env.HUB_PORT) { // pc가 아니고, hub 에서 실행될 때
      cron.schedule(exp, async () => {
        if (!(process.env.PM2_FIRST_PROCESS || process.env.STANDALONE)) return;
        let _t = +new Date, _dt = utils.kstDT(_t);
        let res = await axios.get(`http://localhost:${process.env.PORT}${url}`);
        let doc = {url, exp, res: res.data, _t, _dt, _at: 'hub.utils.autoRenew'};
        await second.log.auto_renew_log.insertOne(doc);
      });
    }
    // return (req, res, next) => { next(); }
  },

  sha256(plain) {
    return crypto.createHash('sha256').update(plain).digest('hex');
  },
  encrypt(message, key, messageEncoding = 'utf8', cipherEncoding = 'base64') {
    const cipher = crypto.createCipheriv('aes-128-cbc', key, this.iv);
    cipher.setAutoPadding(true);

    let encrypted = cipher.update(message, messageEncoding, cipherEncoding);
    encrypted += cipher.final(cipherEncoding);

    return encrypted;
  },
  decrypt(encrypted, key, cipherEncoding = 'base64', messageEncoding = 'utf8') {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, this.iv);
    decipher.setAutoPadding(true);

    let decrypted = decipher.update(encrypted, cipherEncoding, messageEncoding);
    decrypted += decipher.final(messageEncoding);

    return decrypted;
  },


  reduceSingleNode(obj) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      if (obj.length === 1) {
        obj = this.reduceSingleNode(obj[0]);
      } else {
        obj = obj.map(e => this.reduceSingleNode(e));
      }
    } else if (Object.prototype.toString.call(obj) === '[object Object]') {
      Object.keys(obj).forEach(k => {
        obj[k] = this.reduceSingleNode(obj[k]);
      });
    }
    return obj;
  },
  reduceSingleNodeExcept(obj, keys, curKey) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      if (obj.length === 1 && !~keys.indexOf(curKey)) {
        obj = this.reduceSingleNodeExcept(obj[0], keys);
      } else {
        obj = obj.map(e => this.reduceSingleNodeExcept(e, keys));
      }
    } else if (Object.prototype.toString.call(obj) === '[object Object]') {
      Object.keys(obj).forEach(k => {
        obj[k] = this.reduceSingleNodeExcept(obj[k], keys, k);
      });
    }
    return obj;
  },
  reduceSingleNodeNotObject(obj) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      if (obj.length === 1 && Object.prototype.toString.call(obj[0]) !== '[object Object]') {
        obj = this.reduceSingleNodeNotObject(obj[0]);
      } else {
        obj = obj.map(e => this.reduceSingleNodeNotObject(e));
      }
    } else if (Object.prototype.toString.call(obj) === '[object Object]') {
      Object.keys(obj).forEach(k => {
        obj[k] = this.reduceSingleNodeNotObject(obj[k]);
      });
    }
    return obj;
  },
  removeDotFromKey(obj, toSymbol) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      obj = obj.map(e => this.removeDotFromKey(e, toSymbol));
    } else if (Object.prototype.toString.call(obj) === '[object Object]') {
      for (let k of Object.keys(obj)) {
        if (~k.indexOf('.') || ~k.indexOf('$')) {
          let v = obj[k];
          delete obj[k];
          k = k.replace(/\./g, toSymbol || ',');
          k = k.replace(/\$/g, toSymbol || '_');
          obj[k] = v;
        }
        obj[k] = this.removeDotFromKey(obj[k], toSymbol);
      }
    }
    return obj;
  },

  glog(key, value, desc, {type, stack, params} = {}) {
    /**
     * Global Logging
     * https://github.com/balaan-team1/hub/blob/master/src/views/order/DeliveryBoard.vue#L488
     */
    let _t = +new Date, _dt = utils.kstDT(_t);
    type = type || 'node';
    stack = stack || new Error().stack.split('\n')[2];
    let src = stack.match(/\((.+)\)/) ? stack.match(/\((.+)\)/)[1] : stack.replace('    at ', '');
    src = src.replace(/\\/g, '/');
    let loc = src.match(/\/express_base\//), subPath = loc ? src.substring(loc.index + 5) : src;
    let [uri, line] = subPath.split(':');
    second.log.glog.insertOne({app:'ga', type, key, value, src, desc, repo:'https://github.com/balaan-team1/express_base/blob/master/' + uri + '#L' + line, params, _t, _dt});
  },

  deepDiff: (()=>{
    let keyStack = [];
    return {
      VALUE_CREATED: 'created',
      VALUE_UPDATED: 'updated_from',
      VALUE_DELETED: 'deleted',
      VALUE_UNCHANGED: 'unchanged',
      map: function (obj1, obj2, rule, projection) { // projection : mongodb like, 비교대상을 한정한다
        rule = rule || {}; projection = projection || {};
        let projectionHasTrue = Object.values(projection).some(v=>v); // 1, true 등이 하나라도 있다면 projection 에 표시되지 않은 다른 값들은 0 이다
        /**
         * rule, project 는 최초 object에 한해 적용(no recursive)
         */
        if (this.isFunction(obj1) || this.isFunction(obj2)) {
          throw 'Invalid argument. Function given, object expected.';
        }
        if (this.isValue(obj1) || this.isValue(obj2)) {
          let comp = this.compareValues(obj1, obj2);
          if (comp === this.VALUE_UNCHANGED) {
            return null;
          } else if (comp === this.VALUE_UPDATED) {
            return {updated_from: obj1, updated_to: obj2};
          } else {
            // console.log(keyStack.join('.'), comp);
            return {[comp]: obj1 === undefined ? obj2 : obj1};
          }
        }
        if (this.isArray(obj1) || this.isArray(obj2)) {
          // array 특수 룰 필요?
        }

        let diff = {};
        Object.keys(obj1).filter(k=>projection[k] || !projectionHasTrue && projection[k] === undefined).forEach(key => {
          if (~'_id,_t,_dt,_pg,_img_ready,_diff,_diff_history'.split(',').indexOf(key) || this.isFunction(obj1[key])) { return; }
          let value2 = obj2[key] !== undefined ? obj2[key] : undefined;
          // keyStack.push(key);
          if (rule[key]) {
            diff[key] = rule[key](obj1[key], value2);
          } else {
            diff[key] = this.map(obj1[key], value2);
          }
          // keyStack.pop();
        });
        Object.keys(obj2).filter(k=>projection[k] || !projectionHasTrue && projection[k] === undefined).forEach(key => {
          if (~'_id,_t,_dt,_pg,_img_ready,_diff,_diff_history'.split(',').indexOf(key) || this.isFunction(obj2[key]) || diff[key] !== undefined) { return; }
          // keyStack.push(key);
          if (rule[key]) {
            diff[key] = rule[key](undefined, obj2[key]);
          } else {
            diff[key] = this.map(undefined, obj2[key]);
          }
          // keyStack.pop();
        });
        // remove unchanged from diff
        Object.keys(diff).forEach(k => {if (diff[k] === null || this.isObject(diff[k]) && Object.keys(diff[k]).length === 0 || this.isArray(diff[k]) && diff[k].length === 0) delete diff[k];});

        return diff;
      },
      compareValues: function (value1, value2) {
        if (value1 === value2) { return this.VALUE_UNCHANGED; }
        if (value1 == null && value2 == null) { return this.VALUE_UNCHANGED; } // undefined == null 로 취급
        if (this.isDate(value1) && this.isDate(value2) && value1.getTime() === value2.getTime()) {
          return this.VALUE_UNCHANGED;
        }
        if (value1 === undefined) { return this.VALUE_CREATED; }
        if (value2 === undefined) { return this.VALUE_DELETED; }
        return this.VALUE_UPDATED;
      },
      isFunction: function (x) {
        return Object.prototype.toString.call(x) === '[object Function]';
      },
      isArray: function (x) {
        return Object.prototype.toString.call(x) === '[object Array]';
      },
      isDate: function (x) {
        return Object.prototype.toString.call(x) === '[object Date]';
      },
      isObject: function (x) {
        return Object.prototype.toString.call(x) === '[object Object]';
      },
      isValue: function (x) {
        return !this.isObject(x) && !this.isArray(x);
      }
      // isFunction: x => x.constructor.name === 'Function',
      // isArray: x => x.constructor.name === 'Array',
      // isDate: x => x.constructor.name === 'Date',
      // isObject: x => x.constructor.name === 'Object',
      // isValue: function(x){ !this.isObject(x) && !this.isArray(x) }
    }
  })(),
};

(async()=>{
  await HUB_SECONDARY;
  await utils.updateHoliday(momentBiz);
  // console.log(momentBiz('2020-04-09').businessAdd(15));
  // console.log(momentBiz('2020-04-28').businessAdd(16));
})();
