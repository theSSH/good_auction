const mongoose = require('mongoose');

const MAIN = mongoose.createConnection('mongodb://' + process.env.MAIN_DB + '/test?appName=' + process.env.APP_NAME, {useNewUrlParser: true, useUnifiedTopology: true});

let db = new Proxy({}, {
  get(target, name) {
    if (typeof name !== 'string') return;
    let DB = MAIN.useDb(name + (process.env.IS_DEV ? '_dev' : ''));
    return new Proxy({}, {
      get(target, coll) {
        if (typeof coll !== 'string') return;
        return DB.collection(coll);
      }
    });
  }
});

module.exports = {MAIN, db};
