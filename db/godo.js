const mysql = require('mysql');

let [user, password] = (process.env.IS_DEV ? process.env.DB_DEV_MARIA : process.env.DB_PROD_MARIA).split(':');
let host = process.env.IS_DEV ? "dev.ssh.works" : "dev.ssh.works";
let database = process.env.IS_DEV ? 'ga_dev' : 'ga';

module.exports = mysql.createPool({
  host, user, password, database,
  multipleStatements: true,
  connectionLimit : 20,
});
