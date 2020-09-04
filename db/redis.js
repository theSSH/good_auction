const redis = require('async-redis');
const db = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 0});
const lock = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 1});
const timer = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 4});
const cache = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 5});
const session = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 8});

let r = new Proxy({}, {
  get(target, name) {
    if (typeof name !== 'string') return;
    return {db, lock, timer, cache, session}[name];
  }
});

module.exports = r;
