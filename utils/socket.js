const SocketIO = require('socket.io');
const adapter = require('socket.io-redis');
const hostname = require('os').hostname();
const proc = require('child_process');
const REDIS = require('../db/redis');
// console.log(`IS_PM2 ${process.env.IS_PM2}`);

const pm2 = require('pm2');

// get existing workers:
let pm2_worker_ids = [], workerStat = {};
let pm2_id, pm2_env; // my id

pm2.connect(function (err) {
  if (err) console.error(err);
  pm2.list(function (err, data) {
    if (err) console.error(err);
    if (data.length === 0) return; // console.log('not pm2');
    let mydata = data.filter(e=>e.pid === process.pid)[0];
    if (!mydata) return;

    pm2_id = mydata.pm_id;
    pm2_env = mydata.pm2_env;
    pm2_worker_ids = data.map(e=>e.pm_id); // data = [{pid, name, pm2_env:{instances, env, amx_monitor, created_at}, pm_id, monit:{memory, cpu:0}}]
    // console.log(data.filter(e=>e.pid === process.pid)[0]);

    // pm2.sendDataToProcessId(pm2_worker_ids[0], { // target pm_id here...
    //   type: 'some random text',
    //   data: 'hi', // your actual data object you want to pass to the worker
    //   id: pm2_worker_ids[0], // ... and target pm_id here
    //   topic: 'some random text'
    // }, function (err, res) {
    //   // res = {success, data}
    // });
    // pm2.disconnect();
  });
});

function pm2List(cb) {
  pm2.list(function (err, data) {
    if (err) console.error(err);
    if (data.length === 0) return; // console.log('not pm2');
    let mydata = data.filter(e=>e.pid === process.pid)[0];
    pm2_id = mydata.pm_id;
    pm2_env = mydata.pm2_env;
    pm2_worker_ids = data.map(e=>e.pm_id); // data = [{pid, name, pm2_env:{instances, env, amx_monitor, created_at}, pm_id, monit:{memory, cpu:0}}]
    cb && cb();
  });
}

function sendPm2(type, data, exceptMe) {
  pm2_worker_ids.forEach(id=>{
    if (exceptMe && id === pm2_id) return;
    pm2.sendDataToProcessId(id, {
      type, data, id, topic: type
    }, function(err, res){
      if (err || !res.success) {
        if (err.message.match(/Process with ID.*(unknown|offline)/)) { // pm2 scale로 줄일 경우 Error: Process with ID <2> unknown.
          pm2List();
        } else {
          console.error(err, res);
        }
      }
    });
  });
}

let io;
module.exports = {
  getIO: ()=>io,
  sendPm2,
  init: async (server, app) => {
    io = SocketIO(server, {path: '/socket.io'});
    io.adapter(adapter({ pubClient: REDIS.lock, subClient: REDIS.lock }));
    // io.adapter(redis({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 1}));
    app.set('io', io);
    app.set('workerStat', workerStat);

    io.on('connection', (socket) => {
      const req = socket.request;
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      console.log('new client', ip, socket.id, ip);
      socket.join(hostname);

      proc.exec('git rev-parse HEAD', function(err, checksum) {
        proc.exec('git log -1 --pretty=%B', function(err, comment) {
          socket.emit('checksum', checksum.trim(), comment.trim());
        });
      }); // git hash 를 통해 버전을 체크하고, 클라이언트는 버전이 다를 경우 리로딩한다.

      socket.on('disconnect', () => {
        // console.log('client disconnected', ip);
      });
      socket.on('test', (...args) => {
        console.log(...args);
      });
      socket.on('join', (id) => {
        socket.join(id);
        // console.log('join', id);
        // let pMap = app.get('progressMap')[id];
        // if (pMap && pMap.log) socket.emit('log', pMap.log);
      });
    });
  }
};

