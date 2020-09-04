module.exports = {
  async worker(work, feed, size, no, setting) {
    /*
      single thread 기준의 worker 패턴.
      아래와 같이 사용한다.

      const workerCnt = 5, q = Array.apply(null, Array(10)).map((e,i)=>i);
      async function work(no) { return no * no; }
      let pool = Array.apply(null, Array(workerCnt)).map(e=>worker(work, q));

      let st = +new Date;
      let results = await Promise.all(pool);
      let [done, err] = results.map(r=>[r.done, r.err]).reduce((a,b)=>{return [a[0].concat(b[0]), a[1].concat(b[1])]}, [[],[]]);

      log(`worker jobs - done:${done.length}, err:${err.length}`);
      log(`now: ${moment().format("YYYY-MM-DD HH:mm:ss")}, total elapsed: ${((+new Date - st)/1000).toFixed(1)} s`);
    */
    let job;
    while ((job = feed.shift()) != null) {
      let idx = size - feed.length - 1, t = +new Date;
      if (setting.retrying) { // 재작업일 경우 object 가 오기에 작업 보정
        idx = job.idx;
        job = job.job;
      }
      try {
        let res;
        if (setting && setting.timeout) { // timeout이 지정된 경우
          try {
            res = await Promise.race([
              work(job, idx, size, no, setting),
              new Promise((res, rej) => setTimeout(() => rej(new Error('timeout ' + setting.timeout)), setting.timeout * 1000))
            ]);
          } catch (e) {
            setting.err.push({job: job, err: e, elapsed: ((+new Date - t) / 1000)});
            continue;
          }
        } else {
          res = await work(job, idx, size, no, setting);
        }
        setting.done.push({job: job, res: res, idx: idx, elapsed: ((+new Date - t) / 1000)});
        setting.queue && setting.queue.push(res);
        setting.trigger && setting.trigger.resolve(false);
      } catch (e) {
        setting.err.push({job: job, err: e, idx: idx, elapsed: ((+new Date - t) / 1000)});
      } finally {
        if (setting.canceled) return;
      }
    }
    // return setting;
  },

  async workerPool(work, feed, setting) {
    /*
      좀 더 간략화한 worker 패턴.

      async function work(no) { return no * no; }
      workerPool(work, [1,2,3,4,5], 2).then(e=>{console.log(e.done.length, e.err.length)});
    */
    let size = feed.length;
    let pool = Array.apply(null, Array(setting.worker || 10)).map((e, i) => this.worker(work, feed, size, i, setting));
    let st = +new Date;
    setting.err = [];
    await Promise.all(pool);
    // let [done, err] = results.map(r => [r.done, r.err]).reduce((a, b) => {
    //   return [a[0].concat(b[0]), a[1].concat(b[1])]
    // }, [[], []]);
    // return {done: done, err: err, res: done.map(d=>d.res), elapsed: (+new Date - st) / 1000};
    return {elapsed: (+new Date - st) / 1000};
  },

  async doWork(work, feed, setting) {
    /*
      로그를 포함한 최종 worker 패턴

      let worked = await doWork(async no=>no+1, [1,2,3,4,5], {worker:2});
    */
    if (typeof(feed) === 'number') feed = Array.apply(null, Array(feed)).map((e, i) => i); // 숫자만 준 경우 [0, 1, 2, ..] 인 array 생성
    let baseSetting = {
      id: '',
      worker: 10,
      size: feed.length,
      done: [],
      err: [],
      queue: null, // 내용물이 소비되어도 되는 임시 큐, 각 작업의 결과물을 순차적으로 push
      shrink: true, // worked.res 에서 에러로 인해 빈 값을 없앨 것인지
      timeout: null,
      callback: null,
      // cancel: null, // 중지시키기 위한 함수를 받고, 호출되면 중지시킨다.
      pid: null, // 현재 doWork 이 실행되고 있는 pid를 받아온다
      canceled: false, // 중지로 인해 종료되었는지
      trigger: null, // 트리거함수가 있다면 job 이 끝날때마다 실행된다
      onerror: (res,s)=>{console.log(s.err.slice(0,3), s.err.length, 'errors' + (s.id?' with '+s.id:''))}, // (res,s)=>{console.log(s.err.slice(0,3), s.err.length, 'errors' + (s.id?' with '+s.id:''))},
      oncancel: null, // 중지로 인해 종료되었을 때 실행되는 함수
      fLog: (res, s) => {
        if (s.canceled) {
          console.log(`${s.id ? s.id + '] ' : ''}done:${res.done}, err:${res.err}, cancel:${s.size - res.done - res.err}, elapsed:${res.elapsed.toFixed(1)} s`);
        } else {
          console.log(`${s.id ? s.id + '] ' : ''}done:${res.done}, err:${res.err}, elapsed:${res.elapsed.toFixed(1)} s`);
        }
      }
    };
    setting = setting && typeof(setting) === 'object' ? setting : {};
    Object.assign(setting, Object.assign(baseSetting, setting)); // setting 객체를 유지하기 위함
    if (setting.pid) {
      setting.cancelSource = {cancel:()=>{setting.canceled = true}};
      // progress.addCancelToken(setting.pid, setting.cancelSource);
    }

    let result = await this.workerPool(work, feed.slice(), setting);

    if (setting.err.length && setting.retry && !setting.canceled) { // 실패한 작업을 다시 진행한다
      let tried = 0, retryHistory = [{err: setting.err.length}];
      while (setting.retry > tried++ && setting.err.length) {
        setting.retrying = true;
        setting.tried = tried;
        let retryRes = await this.workerPool(work, setting.err, setting);
        result.elapsed += retryRes.elapsed;
        retryHistory.push({err: setting.err.length});
      }

      console.log(`${setting.id || 'doWork'} retry history : ` + retryHistory.map(e => `${e.err} err`).join(' => '));
    }

    if (setting.pid) {
      // progress.removeCancelToken(setting.cancelSource);
    }

    setting.done.sort((a,b)=>a.idx-b.idx); // 결과의 순서를 지키기 위해 idx 순으로 정렬한다
    let data = [];
    if (setting.shrink) {
      setting.done.forEach(e => data.push(e.res)); // 비는 곳 없이 순차 push
    } else {
      setting.done.forEach(e => data[e.idx] = e.res); // 에러가 날 경우 인지하기 위해 해당 인덱스를 비워둔다.
    }
    result.res = data;
    result.done = setting.done.length;
    result.err = setting.err.length;
    if (result.err) result.errSample = setting.err.slice(0, 3);

    if (setting.canceled) {
      result.cancel = setting.size - result.done - result.err;
      setting.oncancel && setting.oncancel(result, setting);
      setting.fLog && setting.fLog(result, setting);
      return result;
    }

    setting.onerror && setting.err.length && setting.onerror(result, setting);
    setting.callback && setting.callback(result, setting);
    setting.fLog && setting.fLog(result, setting);
    return result;
  },

  async doWorkTest() {
    await this.doWork(async no => {
      if (no > 2) {
        return no + 1;
      } else throw new Error('error!');
    }, [1, 2, 3, 4, 5], {id: 'doWorkTest', worker: 10});
  },

  async * doWorkGen(work, feed, setting, returnObj = {}) {
    /*
      yield 로 중간중간 q 에 결과물을 쌓아주는 generator worker 패턴

    let urls = Array.apply(null, Array(30)).map((e,i)=>`http://ip4.ssh.works/?n=${i}`);
    let gen = worker.doWorkGen(async url => {
      let response = await axios.get(url);
      await common.sleep(0.2);
      return response.data.trim();
    }, urls, {worker:3});

    // single thread
    // for await (const value of gen) {
    //   console.log(value, typeof(value));
    //   await common.sleep(0.5);
    // }

    // multiple worker
    await worker.doWork(async (e, feed, size)=>{
      let res, idx = e;
      while(!(res = await gen.next()).done) {
        console.log(e, feed, size);
        await common.sleep(0.1);
        console.log(idx, res.value, typeof(res.value));
      }
    }, 3);
     */
    let q = [], finished = false, trigger = {resolve: () => {}}, orgCallback = setting.callback;
    setting = Object.assign(setting || {}, {queue: q, trigger: trigger, callback: (r, s) => {finished = true; trigger.resolve(true); orgCallback && orgCallback(r, s)}});
    let prm = this.doWork(work, feed, setting);
    let res;
    while ((res = q.shift()) !== undefined || !finished) { // 처리할 결과물이 남아있거나 작업이 덜 끝났거나
      // console.log('doWorkGen res', typeof(res), finished);
      if (res !== undefined) {
        yield res;
      } else {
        await new Promise((resolve) => {
          trigger.resolve = resolve;
        });
      }
    }
    let result = await prm;
    return {...result, ...returnObj};
  },

  async consumeGen(work, gen, setting) {
    /**
     * generator를 받아서 work 를 worker 만큼 진행시켜준다.
     * 이 때 yield 받은 것을 그대로 사용하면 generator 측에서 pending 이 걸리므로
     * 이를 동시진행 가능하도록 한다.
     * work에는 work(jobs, workerNo, setting) 이런식으로 argument가 주어지며 jobs 는 가져온 value와 순서를 포함하여 [{value, idx},..] 형태가 된다.
     * setting.max_jobs_once 로 jobs 의 최대치를 지정할 수 있다(기본 1).
     */
    setting = Object.assign({worker:10, max_jobs_once:1}, setting || {});
    let q = [], part = null, idx = 0, res = [], finished = false, cont = Array(setting.worker).fill(0).map(()=>()=>{});
    let prm = (async () => {
      while (!(part = await gen.next()).done) {
        q.push({value:part.value, idx:idx++});
        cont.forEach(f=>f());
      }
      finished = true;
      cont.forEach(f=>f());
    })();
    let pool = Array.apply(null, Array(setting.worker || 10)).map(async (e, workerNo) => {
      let job;
      while ((job = q.shift()) !== undefined || !finished) { // 처리할 결과물이 남아있거나 작업이 덜 끝났거나
        if (job !== undefined) {
          // setting.max_jobs_once 만큼 빼내서 보낸다
          res[idx] = await work([job].concat(q.splice(0, setting.max_jobs_once == null ? q.length : setting.max_jobs_once - 1)), workerNo, setting);
        } else {
          await new Promise((resolve) => {
            cont[workerNo] = resolve;
          });
        }
      }
    });
    await prm;
    await Promise.all(pool);

    return {res:res, count:idx, value:part.value};
  }
};
